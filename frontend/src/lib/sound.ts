// Короткий "пинь" через Web Audio API. Без внешних файлов — генерируется на лету.
// Браузер блокирует Audio до first user interaction; AudioContext создаётся лениво
// при первом вызове и переживает suspend → resume.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Должен вызываться ВНУТРИ user-gesture handler (например, onClick).
 * Создаёт AudioContext и резюмит его — это обязательно из-за autoplay policy
 * (Chrome/Safari блокируют звук пока не было явного клика на странице).
 * Безопасно вызывать многократно.
 */
export function unlockAudio(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") {
    c.resume().catch(() => {});
  }
}

export async function playMessageBeep(): Promise<void> {
  const c = getCtx();
  if (!c) return;
  // Если context suspended (нет user gesture) — пробуем дождаться resume.
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      return;  // нет user gesture — браузер заблокировал, тихо выходим
    }
  }
  try {
    const now = c.currentTime;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(gain).connect(c.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  } catch {
    // молча — звук не должен ломать UX
  }
}
