import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

AUTH_DIRECTORY = Path.home() / '.vinyl-catalog'
AUTH_STATE = AUTH_DIRECTORY / 'fb_auth.json'


async def main():
    AUTH_DIRECTORY.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=False, channel='chrome')
        context = await browser.new_context()
        page = await context.new_page()
        await page.goto('https://www.facebook.com/', wait_until='domcontentloaded')

        print('Sign in to your own Facebook account in the browser window.', flush=True)
        print('When the Marketplace home page is available, return here and press Enter.', flush=True)
        await asyncio.to_thread(input)

        if 'login' in page.url.lower() or 'checkpoint' in page.url.lower():
            await context.close()
            await browser.close()
            raise RuntimeError('Facebook still shows a login or checkpoint page; finish signing in and run this helper again.')

        await context.storage_state(path=str(AUTH_STATE))
        await context.close()
        await browser.close()

    print(f'Local Facebook session saved to {AUTH_STATE}. Do not share or commit this file.')


if __name__ == '__main__':
    asyncio.run(main())