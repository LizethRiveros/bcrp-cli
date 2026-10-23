"""Original synthesized track + keyboard clicks synced to the typing timeline. No samples, no copyrighted material."""
import json, wave, numpy as np

SR = 44100
DUR = 26.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
t = np.arange(N) / SR
L = np.zeros(N)
R = np.zeros(N)

def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)

def add(buf_l, buf_r, start, sig, pan=0.5):
    i = int(start * SR)
    if i >= N: return
    sig = sig[: N - i]
    buf_l[i:i + len(sig)] += sig * (1 - pan) * 1.4
    buf_r[i:i + len(sig)] += sig * pan * 1.4

BPM = 92
beat = 60 / BPM
bar = 4 * beat
chords = [  # bass, pad notes
    (45, [57, 60, 64, 67, 71]),   # Am9
    (41, [53, 57, 60, 64, 67]),   # Fmaj9
    (48, [55, 59, 62, 64, 71]),   # Cmaj9
    (43, [59, 62, 64, 69, 74]),   # G6/9
]
chord_len = 2 * bar

def env_adsr(n, a, r):
    e = np.ones(n)
    na = min(n, int(a * SR)); nr = min(n, int(r * SR))
    e[:na] *= np.linspace(0, 1, na)
    e[n - nr:] *= np.linspace(1, 0, nr)
    return e

# gates: where drums / arps play
def gate(a, b, fade=.25):
    g = np.zeros(N)
    g[int(a * SR):int(b * SR)] = 1
    k = int(fade * SR)
    c = np.cumsum(np.concatenate([[0], g]))   # moving average in O(N)
    lo = np.clip(np.arange(N) - k // 2, 0, N); hi = np.clip(np.arange(N) + k // 2, 0, N)
    return (c[hi] - c[lo]) / k
drums_on = np.maximum(gate(3.2, 9.8), gate(13.4, 22.4))
arp_on = np.clip(gate(2.4, 22.6, .8) * (1 - .55 * gate(9.9, 13.3, .5)), 0, 1)

# pad + bass
ci = 0
tt = 0.0
while tt < DUR:
    bass, notes = chords[ci % 4]
    ln = chord_len + 1.6
    n = int(ln * SR)
    tn = np.arange(n) / SR
    e = env_adsr(n, 1.4, 1.8)
    padl = np.zeros(n); padr = np.zeros(n)
    for k, m in enumerate(notes):
        f = mtof(m)
        for det, ch in ((-0.35, 0), (0.35, 1)):
            s = np.sin(2 * np.pi * f * (1 + det / 100) * tn) + .35 * np.sin(2 * np.pi * 2 * f * (1 + det / 100) * tn) + .12 * np.sin(2 * np.pi * 3 * f * tn)
            s *= 0.032
            if ch == 0: padl += s
            else: padr += s
    i = int(tt * SR); m_ = min(n, N - i)
    # bass
    fb = mtof(bass - 12 + 12)
    bn = int(chord_len * SR); tb = np.arange(bn) / SR
    be = env_adsr(bn, .08, .6) * (0.55 + .45 * np.exp(-tb * 1.2))
    bs = np.sin(2 * np.pi * fb * tb) * 0.16 * be
    add(L, R, tt, bs, .5)
    # re-add pad properly: left voice to L, right voice to R
    L[i:i + m_] += padl[:m_] * e[:m_]
    R[i:i + m_] += padr[:m_] * e[:m_]
    tt += chord_len; ci += 1

# arpeggio plucks (8th notes), with a simple echo
arp_l = np.zeros(N); arp_r = np.zeros(N)
pattern = [0, 2, 1, 3, 2, 4, 3, 2]
step = beat / 2
k = 0
tt = 2.4
while tt < 22.8:
    ch = int((tt // chord_len)) % 4
    notes = chords[ch][1]
    m = notes[pattern[k % 8] % len(notes)] + 12
    f = mtof(m)
    n = int(.55 * SR); tn = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * tn) + .3 * np.sin(2 * np.pi * 2 * f * tn) + .1 * np.sin(2 * np.pi * 3 * f * tn)) * np.exp(-tn * 7.5) * 0.11
    s *= arp_on[min(N - 1, int(tt * SR))]
    add(arp_l, arp_r, tt, s, .35 + .3 * ((k % 4) / 3))
    tt += step; k += 1
for d, g in ((int(.33 * SR), .32), (int(.66 * SR), .14)):
    arp_l[d:] += arp_l[:-d] * g
    arp_r[d:] += np.roll(arp_r, 0)[:-d] * g
L += arp_l; R += arp_r

# drums
tt = 3.2
hat_l = np.zeros(N)
while tt < 22.4:
    bi = int(round((tt - 3.2) / beat)) if tt >= 3.2 else 0
    g = drums_on[min(N - 1, int(tt * SR))]
    if g > 0:
        if bi % 2 == 0:
            n = int(.3 * SR); tn = np.arange(n) / SR
            fr = 45 + 90 * np.exp(-tn * 28)
            kick = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-tn * 9) * 0.42 * g
            add(L, R, tt, kick, .5)
        # off-beat hat
        th = tt + beat / 2
        n = int(.06 * SR)
        noise = rng.standard_normal(n); noise = np.diff(noise, prepend=0)
        hat = noise * np.exp(-np.arange(n) / SR * 70) * 0.05 * drums_on[min(N - 1, int(th * SR))]
        add(L, R, th, hat, .6)
    tt += beat

# keyboard clicks synced to the video's typing
for c in json.load(open("clicks.json")):
    n = int(.05 * SR) if not c["s"] else int(.11 * SR)
    noise = rng.standard_normal(n); noise = np.diff(noise, prepend=0)
    tn = np.arange(n) / SR
    s = noise * np.exp(-tn * (90 if not c["s"] else 45)) * (0.16 if not c["s"] else 0.3)
    s += np.sin(2 * np.pi * (170 if c["s"] else 230) * tn) * np.exp(-tn * (40 if c["s"] else 60)) * (0.18 if c["s"] else 0.07)
    add(L, R, c["t"], s * (0.8 + .4 * rng.random()), .5 + (rng.random() - .5) * .2)

# transitions: soft whoosh on scene changes
for tw in (3.2, 9.7, 13.4, 22.3):
    n = int(.7 * SR); tn = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = np.convolve(noise, np.ones(40) / 40, mode="same")
    s = noise * np.sin(np.pi * tn / .7) ** 2 * 0.09
    add(L, R, tw - .35, s, .5)

# master
fade_in = np.clip(t / .8, 0, 1); fade_out = np.clip((DUR - t) / 1.6, 0, 1)
L *= fade_in * fade_out; R *= fade_in * fade_out
peak = max(np.abs(L).max(), np.abs(R).max())
L = L / peak * .88; R = R / peak * .88
out = np.stack([L, R], 1)
with wave.open("music.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("ok", out.shape, "peak", peak)
