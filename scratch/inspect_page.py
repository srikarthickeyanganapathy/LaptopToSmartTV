import asyncio
import json
import urllib.request
import websockets

async def inspect():
    raw = urllib.request.urlopen('http://127.0.0.1:9222/json').read()
    targets = json.loads(raw)
    ws_url = targets[0]['webSocketDebuggerUrl']
    async with websockets.connect(ws_url) as ws:
        expr = """
        ({
            title: document.title,
            url: window.location.href,
            bodyText: (document.body ? document.body.innerText.slice(0, 300) : ''),
            htmlSnippet: (document.documentElement ? document.documentElement.outerHTML.slice(0, 500) : ''),
            userAgent: navigator.userAgent
        })
        """
        await ws.send(json.dumps({
            "id": 10,
            "method": "Runtime.evaluate",
            "params": {"expression": expr, "returnByValue": True}
        }))
        res = await ws.recv()
        data = json.loads(res)
        print("Page state:")
        print(json.dumps(data.get("result", {}).get("result", {}).get("value", {}), indent=2))

asyncio.run(inspect())
