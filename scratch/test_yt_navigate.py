import sys, os, urllib.request, json, asyncio, websockets
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core.config import SMART_TV_UA

async def main():
    targets = json.loads(urllib.request.urlopen('http://127.0.0.1:9222/json').read().decode())
    page = [t for t in targets if t.get('type') == 'page'][0]
    ws_url = page['webSocketDebuggerUrl']
    print("Connecting to:", ws_url)
    async with websockets.connect(ws_url) as ws:
        async def send(method, params=None):
            req = {'id': 999, 'method': method}
            if params:
                req['params'] = params
            await ws.send(json.dumps(req))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get('id') == 999:
                    return resp

        print("1. Overriding UA with Tizen Metadata...")
        await send('Emulation.setUserAgentOverride', {
            'userAgent': SMART_TV_UA,
            'platform': 'Tizen',
            'userAgentMetadata': {
                'brands': [{'brand': 'SamsungBrowser', 'version': '4.0'}],
                'platform': 'Tizen',
                'platformVersion': '6.0',
                'architecture': 'arm',
                'model': 'SMART-TV',
                'mobile': False
            }
        })

        print("2. Navigating to https://www.youtube.com/tv ...")
        await send('Page.navigate', {'url': 'https://www.youtube.com/tv'})

        # Wait for navigation
        for i in range(1, 6):
            await asyncio.sleep(1.0)
            eval_res = await send('Runtime.evaluate', {
                'expression': 'JSON.stringify({ url: location.href, title: document.title, bodyLen: document.body.innerHTML.length, ready: document.readyState })',
                'returnByValue': True
            })
            val = eval_res.get('result', {}).get('result', {}).get('value')
            print(f"Status at t={i}s:", val)

asyncio.run(main())
