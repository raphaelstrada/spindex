import asyncio
import base64
import hmac
import json
import re
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright

HOST = '127.0.0.1'
PORT = 8765
MAX_URLS = 10
MAX_IMAGES_PER_LISTING = 5
MAX_IMAGE_BYTES = 8 * 1024 * 1024
AUTH_STATE = Path.home() / '.spindex' / 'fb_auth.json'
LEGACY_AUTH_STATE = Path.home() / '.vinyl-catalog' / 'fb_auth.json'
ALLOWED_ORIGINS = {
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://raphaelstrada.github.io',
}
ALLOWED_IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'}
THUMBNAILS_XPATH = '/html/body/div[1]/div/div[1]/div/div[3]/div/div/div[1]/div[1]/div[2]/div/div/div/div/div/div[1]/div[2]/div/div[1]/div/div[3]/div'
MAIN_IMAGE_XPATH = '/html/body/div[1]/div/div[1]/div/div[3]/div/div/div[1]/div[1]/div[2]/div/div/div/div/div/div[1]/div[2]/div/div[1]/div/div[2]'
PRICE_PATTERN = re.compile(r'(CA\$|C\$|CAD|US\$|USD|\$)\s*(\d[\d,]*(?:\.\d{1,2})?)', re.IGNORECASE)
BRIDGE_TOKEN = secrets.token_urlsafe(32)


def validate_listing_url(value):
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    host = (parsed.hostname or '').lower()
    return (
        parsed.scheme == 'https'
        and host in {'facebook.com', 'www.facebook.com', 'm.facebook.com'}
        and re.fullmatch(r'/marketplace/item/\d+/?', parsed.path) is not None
    )


def extract_asking_price(text):
    match = PRICE_PATTERN.search(text)
    if not match:
        return None, None
    marker = match.group(1).upper()
    currency = 'USD' if marker in {'US$', 'USD'} else 'CAD'
    try:
        amount = float(match.group(2).replace(',', ''))
    except ValueError:
        return None, None
    return amount, currency


async def scrape_listings(urls):
    auth_state = AUTH_STATE if AUTH_STATE.is_file() else LEGACY_AUTH_STATE
    if not auth_state.is_file():
        raise RuntimeError(f'Facebook session file was not found at {AUTH_STATE}. Run marketplace_login.py first.')

    listings = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=False, channel='chrome')
        context = await browser.new_context(storage_state=str(auth_state))
        page = await context.new_page()

        try:
            for source_url in urls:
                await page.goto(source_url, wait_until='domcontentloaded', timeout=45_000)
                if any(marker in page.url.lower() for marker in ('login', 'checkpoint')):
                    raise RuntimeError('Facebook requires a valid local session. Refresh ~/fb_auth.json and try again.')

                main = page.locator('div[role="main"]')
                await main.locator('img').first.wait_for(timeout=15_000)
                listing_title = (await page.title()).strip()
                description = (await main.inner_text(timeout=10_000)).strip()[:18_000]
                asking_price, currency = extract_asking_price(f'{listing_title}\n{description}')
                image_urls = []
                thumbnails = page.locator(f'xpath={THUMBNAILS_XPATH}').locator('img')
                thumbnail_count = await thumbnails.count()

                if thumbnail_count:
                    for index in range(min(thumbnail_count, MAX_IMAGES_PER_LISTING)):
                        try:
                            await thumbnails.nth(index).click(timeout=3_000)
                            await page.wait_for_timeout(500)
                            sources = await page.locator(f'xpath={MAIN_IMAGE_XPATH}').locator('img').evaluate_all(
                                'images => images.map(image => image.currentSrc || image.src).filter(Boolean)',
                            )
                            for source in sources:
                                if source.startswith('https://') and source not in image_urls:
                                    image_urls.append(source)
                        except Exception:
                            continue
                else:
                    sources = await page.locator(f'xpath={MAIN_IMAGE_XPATH}').locator('img').evaluate_all(
                        'images => images.map(image => image.currentSrc || image.src).filter(Boolean)',
                    )
                    image_urls.extend(source for source in sources if source.startswith('https://'))

                images = []
                for image_url in image_urls[:MAX_IMAGES_PER_LISTING]:
                    try:
                        response = await context.request.get(image_url, timeout=20_000)
                        if not response.ok:
                            continue
                        media_type = response.headers.get('content-type', 'image/jpeg').split(';', 1)[0].lower()
                        if media_type not in ALLOWED_IMAGE_TYPES:
                            continue
                        image_bytes = await response.body()
                        if len(image_bytes) > MAX_IMAGE_BYTES:
                            continue
                        images.append({
                            'mediaType': media_type,
                            'dataBase64': base64.b64encode(image_bytes).decode('ascii'),
                        })
                    except Exception:
                        continue

                listings.append({
                    'sourceUrl': source_url,
                    'listingTitle': listing_title,
                    'description': description,
                    'askingPrice': asking_price,
                    'currency': currency,
                    'images': images,
                })
        finally:
            await context.close()
            await browser.close()

    return listings


class BridgeHandler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def send_json(self, status, payload, origin):
        encoded = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(encoded)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Vary', 'Origin')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.end_headers()
        self.wfile.write(encoded)

    def do_OPTIONS(self):
        origin = self.headers.get('Origin', '')
        if origin not in ALLOWED_ORIGINS:
            self.send_json(403, {'error': 'Origin is not allowed.'}, '')
            return
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', origin)
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'content-type,x-marketplace-bridge-token')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Max-Age', '600')
        self.send_header('Vary', 'Origin')
        self.end_headers()

    def do_POST(self):
        origin = self.headers.get('Origin', '')
        if origin not in ALLOWED_ORIGINS:
            self.send_json(403, {'error': 'Origin is not allowed.'}, '')
            return
        if self.path != '/api/marketplace-listings':
            self.send_json(404, {'error': 'Endpoint not found.'}, origin)
            return
        supplied_token = self.headers.get('X-Marketplace-Bridge-Token', '')
        if not hmac.compare_digest(supplied_token, BRIDGE_TOKEN):
            self.send_json(401, {'error': 'Invalid local bridge token.'}, origin)
            return

        try:
            content_length = int(self.headers.get('Content-Length', '0'))
            if content_length < 1 or content_length > 64_000:
                self.send_json(413, {'error': 'Request body is too large.'}, origin)
                return
            body = json.loads(self.rfile.read(content_length))
            urls = body.get('urls') if isinstance(body, dict) else None
            if not isinstance(urls, list) or not 1 <= len(urls) <= MAX_URLS:
                self.send_json(400, {'error': f'Send between one and {MAX_URLS} Marketplace URLs.'}, origin)
                return
            if not all(isinstance(url, str) and validate_listing_url(url) for url in urls):
                self.send_json(400, {'error': 'Only Facebook Marketplace item URLs are supported.'}, origin)
                return

            listings = asyncio.run(scrape_listings(urls))
            self.send_json(200, {'listings': listings}, origin)
        except RuntimeError as error:
            self.send_json(503, {'error': str(error)}, origin)
        except Exception as error:
            print(f'Marketplace import failed: {type(error).__name__}')
            self.send_json(502, {'error': 'Could not read this Marketplace listing. Check the local Facebook session and try again.'}, origin)


if __name__ == '__main__':
    server = ThreadingHTTPServer((HOST, PORT), BridgeHandler)
    print(f'Marketplace bridge listening at http://{HOST}:{PORT}')
    print(f'Paste this temporary bridge token into the app: {BRIDGE_TOKEN}', flush=True)
    print(f'Facebook session file: {AUTH_STATE}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()