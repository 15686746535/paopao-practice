# -*- coding: utf-8 -*-
"""扫描泡泡钢琴 BLE 设备"""
import asyncio
import sys
from bleak import BleakScanner

# 从 APK 逆向得到的设备名前缀 (DeviceManager.mpDeviceNameList) + 鼓机
NAME_PREFIXES = ["MP", "POP Keyboard", "PianoProdigy", "GPP", "Xkey", "POP Conga", "POP", "pop"]
# 厂商自定义 MIDI 服务 UUID
PIANO_SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700"


def interesting(name: str, uuids) -> bool:
    if name and any(name.startswith(p) for p in NAME_PREFIXES):
        return True
    if uuids and PIANO_SERVICE_UUID in [u.lower() for u in uuids]:
        return True
    return False


async def main():
    print("扫描 BLE 设备 (10 秒)...")
    devices = await BleakScanner.discover(timeout=10.0, return_adv=True)
    hits, others = [], []
    for addr, (dev, adv) in devices.items():
        name = dev.name or (adv.local_name or "")
        uuids = adv.service_uuids or []
        row = (addr, name, dev.rssi, [u for u in uuids][:4])
        if interesting(name, uuids):
            hits.append(row)
        elif name:
            others.append(row)

    print("\n=== 命中的钢琴设备 ===")
    for addr, name, rssi, uuids in sorted(hits, key=lambda x: -x[2]):
        print(f"  {addr}  |  {name:<28} | RSSI {rssi} | services={uuids}")
    if not hits:
        print("  (无)")
        print("\n=== 其他可见 BLE 设备（可能有未识别的琴） ===")
        for addr, name, rssi, _ in sorted(others, key=lambda x: -x[2])[:25]:
            print(f"  {addr}  |  {name:<28} | RSSI {rssi}")


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
