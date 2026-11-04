"""TCP proxy that adds a fixed one-way delay to every chunk (simulates a distant database).

Usage: python delay_proxy.py <listen_port> <target_port> <one_way_ms>
Round trip added ~= 2 * one_way_ms.
"""
import asyncio
import sys

LISTEN = int(sys.argv[1])
TARGET = int(sys.argv[2])
DELAY = float(sys.argv[3]) / 1000.0


async def pipe(reader, writer):
    """Read chunks, delay each by DELAY seconds, then write. Order is preserved."""
    queue: asyncio.Queue = asyncio.Queue()

    async def reader_loop():
        try:
            while True:
                data = await reader.read(65536)
                if not data:
                    break
                await queue.put((asyncio.get_running_loop().time() + DELAY, data))
        finally:
            await queue.put(None)

    async def writer_loop():
        loop = asyncio.get_running_loop()
        while True:
            item = await queue.get()
            if item is None:
                break
            due, data = item
            wait = due - loop.time()
            if wait > 0:
                await asyncio.sleep(wait)
            writer.write(data)
            await writer.drain()
        writer.close()

    await asyncio.gather(reader_loop(), writer_loop(), return_exceptions=True)


async def handle(client_reader, client_writer):
    try:
        server_reader, server_writer = await asyncio.open_connection("127.0.0.1", TARGET)
    except OSError:
        client_writer.close()
        return
    await asyncio.gather(
        pipe(client_reader, server_writer),
        pipe(server_reader, client_writer),
        return_exceptions=True,
    )


async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", LISTEN)
    print(f"proxy 127.0.0.1:{LISTEN} -> 127.0.0.1:{TARGET}, one-way {DELAY*1000:.0f} ms", flush=True)
    async with server:
        await server.serve_forever()


asyncio.run(main())
