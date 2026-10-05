import asyncio
import socket
import threading
import tkinter as tk
import webbrowser
from http.server import ThreadingHTTPServer
from tkinter import messagebox, ttk

from marketplace_bridge import AUTH_STATE, LEGACY_AUTH_STATE, BRIDGE_TOKEN, BridgeHandler, HOST, PORT
from marketplace_login import save_facebook_session

CATALOG_URL = 'https://raphaelstrada.github.io/vinyl-catalog/'

def port_in_use() -> bool:
    """Return True when something is already listening on the helper port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1)
        return sock.connect_ex((HOST, PORT)) == 0


class MarketplaceHelperApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title('Vinyl Catalog - Marketplace Helper')
        self.root.geometry('560x480')
        self.root.minsize(500, 440)
        self.root.protocol('WM_DELETE_WINDOW', self.close)

        self.status = tk.StringVar(value='Ready')
        self.token = tk.StringVar(value='')
        self.save_requested = threading.Event()
        self.login_thread: threading.Thread | None = None
        self.server: ThreadingHTTPServer | None = None

        container = ttk.Frame(root, padding=24)
        container.pack(fill='both', expand=True)
        container.columnconfigure(0, weight=1)

        ttk.Label(container, text='Marketplace import', font=('', 20, 'bold')).grid(row=0, column=0, sticky='w')
        ttk.Label(
            container,
            text='Sign in to Facebook locally, then use the Marketplace link importer in Vinyl Catalog.',
            wraplength=500,
        ).grid(row=1, column=0, sticky='w', pady=(8, 18))

        session_exists = AUTH_STATE.is_file() or LEGACY_AUTH_STATE.is_file()
        session_text = 'Facebook session found on this computer.' if session_exists else 'Sign in to Facebook to create a local session.'
        ttk.Label(container, text=session_text, wraplength=500).grid(row=2, column=0, sticky='w', pady=(0, 10))

        self.login_button = ttk.Button(container, text='1. Open Facebook sign-in', command=self.open_login)
        self.login_button.grid(row=3, column=0, sticky='ew', pady=4)

        self.save_button = ttk.Button(
            container,
            text='2. I am signed in - save session',
            command=self.save_session,
            state='disabled',
        )
        self.save_button.grid(row=4, column=0, sticky='ew', pady=4)

        self.start_button = ttk.Button(
            container,
            text='Start Marketplace helper',
            command=self.start_bridge,
            state='normal' if session_exists else 'disabled',
        )
        self.start_button.grid(row=5, column=0, sticky='ew', pady=(12, 4))

        ttk.Label(container, text='Temporary token').grid(row=6, column=0, sticky='w', pady=(14, 4))
        token_row = ttk.Frame(container)
        token_row.grid(row=7, column=0, sticky='ew')
        token_row.columnconfigure(0, weight=1)
        self.token_entry = ttk.Entry(token_row, textvariable=self.token, state='readonly')
        self.token_entry.grid(row=0, column=0, sticky='ew', padx=(0, 8))
        self.copy_button = ttk.Button(token_row, text='Copy token', command=self.copy_token, state='disabled')
        self.copy_button.grid(row=0, column=1)

        ttk.Button(container, text='Open Vinyl Catalog', command=lambda: webbrowser.open(CATALOG_URL)).grid(
            row=8, column=0, sticky='ew', pady=(10, 4),
        )
        ttk.Label(container, textvariable=self.status, wraplength=500).grid(row=9, column=0, sticky='w', pady=(12, 0))
        ttk.Label(
            container,
            text='No Facebook API token is needed. Your Facebook session stays on this computer. Do not share the temporary token.',
            wraplength=500,
            foreground='#555555',
        ).grid(row=10, column=0, sticky='w', pady=(14, 0))

    def set_status(self, text: str):
        try:
            self.root.after(0, self.status.set, text)
        except tk.TclError:
            pass

    def open_login(self):
        if self.login_thread and self.login_thread.is_alive():
            return

        self.save_requested.clear()
        self.login_button.configure(state='disabled')
        self.save_button.configure(state='disabled')
        self.set_status('Opening Facebook in your browser...')

        def on_browser_ready():
            self.root.after(0, lambda: self.save_button.configure(state='normal'))
            self.set_status('Sign in to your own Facebook account, then click “I am signed in”.')

        def worker():
            try:
                auth_path = asyncio.run(save_facebook_session(self.save_requested, on_browser_ready))
                self.set_status(f'Facebook session saved locally: {auth_path}')
                self.root.after(0, lambda: self.start_button.configure(state='normal'))
                self.root.after(0, self.start_bridge)
            except Exception as error:
                self.set_status(str(error))
                self.root.after(0, lambda: self.login_button.configure(state='normal'))
                self.root.after(0, lambda: self.save_button.configure(state='disabled'))

        self.login_thread = threading.Thread(target=worker, daemon=True)
        self.login_thread.start()

    def save_session(self):
        self.save_button.configure(state='disabled')
        self.set_status('Saving your local Facebook session...')
        self.save_requested.set()

    def start_bridge(self):
        if self.server:
            self.set_status(f'Marketplace helper is running at http://{HOST}:{PORT}.')
            return
        if not (AUTH_STATE.is_file() or LEGACY_AUTH_STATE.is_file()):
            self.set_status('Sign in to Facebook first to create a local session.')
            return

        try:
            self.server = ThreadingHTTPServer((HOST, PORT), BridgeHandler)
        except OSError as error:
            if port_in_use():
                self.set_status(
                    f'A helper is already running at http://{HOST}:{PORT}. Use the helper window that is already open '
                    '(copy the token there), or close it and any terminal running marketplace_bridge.py, then click Start again.'
                )
            else:
                self.set_status(f'Could not start the local helper: {error}')
            return

        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.token.set(BRIDGE_TOKEN)
        self.copy_button.configure(state='normal')
        self.set_status(f'Helper ready at http://{HOST}:{PORT}. Paste the token into Upload a Picture > Link to Marketplace.')

    def copy_token(self):
        if not self.token.get():
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(self.token.get())
        self.set_status('Temporary token copied. Paste it into the Marketplace import panel.')

    def close(self):
        self.save_requested.set()
        if self.server:
            self.server.shutdown()
            self.server.server_close()
        self.root.destroy()


def main():
    root = tk.Tk()
    MarketplaceHelperApp(root)
    root.mainloop()


if __name__ == '__main__':
    main()