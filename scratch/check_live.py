import asyncio
import json
import websockets
import urllib.request

async def check():
    targets = json.loads(urllib.request.urlopen('http://127.0.0.1:9222/json').read())
    page = [t for t in targets if t.get('type') == 'page'][0]
    uri = page['webSocketDebuggerUrl']
    print("Page URL:", page.get('url'))
    print("Page Title:", page.get('title'))
    
    async with websockets.connect(uri) as ws:
        async def call(method, params=None):
            msg = {'id': 1, 'method': method}
            if params:
                msg['params'] = params
            await ws.send(json.dumps(msg))
            while True:
                r = json.loads(await ws.recv())
                if r.get('id') == 1:
                    return r

        # 1. Check navigator.userAgent
        res = await call('Runtime.evaluate', {
            'expression': '''({
                userAgent: navigator.userAgent,
                platform: navigator.platform,
                vendor: navigator.vendor,
                appVersion: navigator.appVersion
            })''',
            'returnByValue': True
        })
        print("\n--- Navigator Info ---")
        print(json.dumps(res.get('result', {}).get('result', {}).get('value', {}), indent=2))

        # 2. Check if the dialog is in the DOM
        res2 = await call('Runtime.evaluate', {
            'expression': '''({
                hasBlockedText: document.body ? document.body.innerText.includes("DevTools not allowed") : false,
                hasOrganizationText: document.body ? document.body.innerText.includes("Your organization has blocked") : false,
                iframes: Array.from(document.querySelectorAll("iframe")).map(f => f.src)
            })''',
            'returnByValue': True
        })
        print("\n--- DOM Inspection ---")
        print(json.dumps(res2.get('result', {}).get('result', {}).get('value', {}), indent=2))

asyncio.run(check())
