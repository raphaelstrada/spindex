import asyncio
import threading
from pathlib import Path
from typing import Callable

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import async_playwright

AUTH_DIRECTORY = Path.home() / '.vinyl-catalog'
AUTH_STATE = AUTH_DIRECTORY / 'fb_auth.json'


async def launch_browser(playwright):
    errors = []
    for channel in ('chrome', 'msedge'):
        try:
            return await playwright.chromium.launch(headless=False, channel=channel)
        except PlaywrightError as error:
            errors.append(error)
    raise RuntimeError('Install Google Chrome or Microsoft Edge, then try again.') from errors[-1]


async def save_facebook_session(save_requested: threading.Event, on_browser_ready: Callable[[], None]) -> str:
    AUTH_DIRECTORY.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await launch_browser(playwright)
        context = await browser.new_context()
        page = await context.new_page()
        await page.goto('https://www.facebook.com/', wait_until='domcontentloaded')
        on_browser_ready()
        saved = await asyncio.to_thread(save_requested.wait, 10 * 60)
        if not saved:
            await context.close()
            await browser.close()
            raise RuntimeError('Facebook sign-in timed out. Start login again and press Save after signing in.')
        if any(marker in page.url.lower() for marker in ('login', 'checkpoint')):
            await context.close()
            await browser.close()
            raise RuntimeError('Facebook still shows a login/checkpoint page. Finish signing in and try again.')

        try:
            await context.storage_state(path=str(AUTH_STATE))
        finally:
            await context.close()
            await browser.close()

    return str(AUTH_STATE)


async def main():
    save_requested = threading.Event()
    task = asyncio.create_task(save_facebook_session(
        save_requested,
        lambda: print('Sign into Facebook in the opened browser, then return here and press Enter.', flush=True),
    ))
    await asyncio.to_thread(input)
    save_requested.set()
    auth_path = await task
    print(f'Local Facebook session saved to {auth_path}. Do not share or commit this file.')


if __name__ == '__main__':
    asyncio.run(main())