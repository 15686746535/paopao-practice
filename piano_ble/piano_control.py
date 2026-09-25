# -*- coding: utf-8 -*-
"""
泡泡钢琴 BLE 直连控制脚本
协议来源：对 cn.abcpiano.pianist APK 的逆向分析

- Service:  03B80E5A-EDE8-4B33-A751-6CE34EC4C700 (厂商自定义 MIDI 服务)
- Char:     7772E5DB-3868-4112-A1A9-F2669D106BF3 (Write + Notify)
- 帧格式:   80 80 <MIDI...>   (0x80 0x80 = BLE-MIDI 头 + 时间戳0)
- SysEx:    80 80 F0 <cmd> <param> <0x7F-cmd> <param^0x7F> F7
"""
import asyncio
import sys
import time
from bleak import BleakClient

SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700"
CHAR_UUID = "7772e5db-3868-4112-a1a9-f2669d106bf3"


def midi(*body: int) -> bytes:
    """包上 80 80 头"""
    return bytes([0x80, 0x80, *body])


def sysex_param(cmd: int, param: int) -> bytes:
    """POPPianoProtocol 参数命令帧"""
    frame = bytes([0xF0, cmd, param & 0x7F, (0x7F - cmd) & 0x7F, (param ^ 0x7F) & 0x7F])
    return midi(*frame, 0xF7)


def sysex_open(cmd: int, param: int) -> bytes:
    """POPPianoProtocol 开关命令帧（0x7E 结尾）"""
    frame = bytes([0xF0, cmd, param & 0x7F, (0x7F - cmd) & 0x7F, 0x7E])
    return midi(*frame, 0xF7)


# ---- 常用命令 ----
HANDSHAKE = sysex_open(0x0C, 0x01)          # 请求控制权  F0 0C 01 73 7E
SUSTAIN_ON = sysex_open(0x09, 0x01)          # 延音开
SUSTAIN_OFF = sysex_open(0x09, 0x00)
METRONOME_ON = sysex_param(0x06, 0x01)       # 节拍器开
METRONOME_OFF = sysex_param(0x06, 0x00)


def note_on(note: int, velocity: int = 100, channel: int = 0) -> bytes:
    return midi(0x90 | channel, note & 0x7F, velocity & 0x7F)


def note_off(note: int, channel: int = 0) -> bytes:
    return midi(0x80 | channel, note & 0x7F, 0x00)


def program_change(tone: int) -> bytes:
    return midi(0xC0, tone & 0x7F)


rx_log = []


def on_rx(char, data: bytearray):
    ts = time.strftime("%H:%M:%S")
    hexs = " ".join(f"{b:02X}" for b in data)
    print(f"  [{ts}] 琴→APP: {hexs}")
    rx_log.append((ts, bytes(data)))


async def connect(addr: str) -> BleakClient:
    print(f"连接 {addr} ...")
    client = BleakClient(addr)
    await client.connect()
    print("已连接，服务:", [str(s.uuid) for s in client.services][:6])
    await client.start_notify(CHAR_UUID, on_rx)
    print("已订阅通知")
    return client


async def demo(client: BleakClient):
    print("\n[1] 发送握手(请求控制权):", HANDSHAKE.hex(" "))
    await client.write_gatt_char(CHAR_UUID, HANDSHAKE, response=False)
    await asyncio.sleep(1.0)

    print("\n[2] 弹一个中央 C (note 60, 力度 100)")
    await client.write_gatt_char(CHAR_UUID, note_on(60, 100), response=False)
    await asyncio.sleep(0.8)
    await client.write_gatt_char(CHAR_UUID, note_off(60), response=False)

    print("\n[3] 弹一段小旋律")
    melody = [(60, 0.35), (62, 0.35), (64, 0.35), (65, 0.35), (67, 0.7),
              (65, 0.35), (67, 1.0)]
    for n, dur in melody:
        await client.write_gatt_char(CHAR_UUID, note_on(n, 100), response=False)
        await asyncio.sleep(dur)
        await client.write_gatt_char(CHAR_UUID, note_off(n), response=False)
        await asyncio.sleep(0.03)


async def main():
    addr = sys.argv[1] if len(sys.argv) > 1 else None
    if not addr:
        print("用法: python piano_control.py <MAC地址或UUID>")
        sys.exit(1)
    client = await connect(addr)
    try:
        await demo(client)
        print("\n保持连接 30 秒，可手按琴键观察接收数据 (Ctrl+C 退出)")
        await asyncio.sleep(30)
    finally:
        await client.stop_notify(CHAR_UUID)
        await client.disconnect()
        print("已断开")


if __name__ == "__main__":
    asyncio.run(main())
