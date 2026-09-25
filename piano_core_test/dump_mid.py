# -*- coding: utf-8 -*-
# 一次性调试工具：dump SMF 音符事件（Delta+运行状态，够用）
import struct, sys

def read_varint(d, i):
    v = 0
    while True:
        b = d[i]; i += 1
        v = (v << 7) | (b & 0x7F)
        if not (b & 0x80): return v, i

def dump(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'MThd'
    fmt, ntrk, div = struct.unpack('>HHH', d[8:14])
    print(f"format={fmt} tracks={ntrk} division={div}")
    i = 14
    for t in range(ntrk):
        assert d[i:i+4] == b'MTrk'; i += 4
        ln = struct.unpack('>I', d[i:i+4])[0]; i += 4
        end = i + ln
        tick = 0; run = None
        tempo = None; name = ''
        notes = []  # (tick, midi, dur_ticks, ch, vel)
        on = {}
        while i < end:
            delta, i = read_varint(d, i)
            tick += delta
            b = d[i]
            if b & 0x80:
                status = b; i += 1
            else:
                status = run
            run = status
            hi = status & 0xF0
            if status == 0xFF:
                mt = d[i]; i += 1
                ln2, i = read_varint(d, i)
                data = d[i:i+ln2]; i += ln2
                if mt == 0x51: tempo = struct.unpack('>I', b'\x00' + data)[0]
                if mt == 0x03: name = data.decode('latin1', 'ignore')
            elif hi in (0x80, 0x90):
                note, vel = d[i], d[i+1]; i += 2
                ch = status & 0x0F
                if hi == 0x90 and vel > 0:
                    on.setdefault((ch, note), []).append((tick, vel))
                else:
                    k = (ch, note)
                    if on.get(k):
                        t0, v0 = on[k].pop(0)
                        notes.append((t0, note, tick - t0, ch, v0))
            elif hi in (0xA0, 0xB0, 0xE0): i += 2
            elif hi in (0xC0, 0xD0): i += 1
        i = end
        print(f"--- track {t}: name={name!r} tempo={tempo} bpm={60e6/tempo if tempo else None} notes={len(notes)}")
        notes.sort()
        for t0, n, dur, ch, vel in notes:
            print(f"  t={t0:6d} note={n:3d} ({['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n%12]}{n//12-1}) dur={dur:5d} ch={ch} vel={vel}")

dump(sys.argv[1])
