type OrbDot = {
  x: number;
  y: number;
  z: number;
};

const DOT_COUNT = 428;
const PERIOD_SECONDS = 4;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const ORB_RADIUS_RATIO = .442;
const DOT_RADIUS = .95;

const dots: OrbDot[] = Array.from({ length: DOT_COUNT }, (_, index) => {
  const y = 1 - (2 * (index + .5)) / DOT_COUNT;
  const radius = Math.sqrt(1 - y * y);
  const angle = index * GOLDEN_ANGLE;

  return {
    x: Math.cos(angle) * radius,
    y,
    z: Math.sin(angle) * radius,
  };
});

const drawOrb = (
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  seconds: number,
) => {
  const size = canvas.clientWidth || 84;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelSize = Math.max(1, Math.round(size * dpr));

  if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
    canvas.width = pixelSize;
    canvas.height = pixelSize;
  }

  const phase = (seconds % PERIOD_SECONDS) / PERIOD_SECONDS * Math.PI * 2;
  const sphereRadius = size * ORB_RADIUS_RATIO;
  const center = size / 2;
  const yaw = Math.sin(phase) * .42;
  const pitch = Math.cos(phase) * .18;
  const roll = Math.sin(phase * 2) * .08;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, size, size);

  dots
    .map((dot) => {
      const yawX = dot.x * cosYaw + dot.z * sinYaw;
      const yawZ = -dot.x * sinYaw + dot.z * cosYaw;
      const pitchY = dot.y * cosPitch - yawZ * sinPitch;
      const pitchZ = dot.y * sinPitch + yawZ * cosPitch;
      const x = yawX * cosRoll - pitchY * sinRoll;
      const y = yawX * sinRoll + pitchY * cosRoll;
      const depth = (pitchZ + 1) / 2;
      const perspective = 1 + pitchZ * .07;

      return {
        x: center + x * sphereRadius * perspective,
        y: center + y * sphereRadius * perspective,
        z: pitchZ,
        radius: DOT_RADIUS,
        alpha: .56 + depth * .44,
      };
    })
    .sort((left, right) => left.z - right.z)
    .forEach((dot) => {
      context.fillStyle = `rgba(255, 255, 255, ${dot.alpha})`;
      context.beginPath();
      context.arc(dot.x, dot.y, dot.radius, 0, Math.PI * 2);
      context.fill();
    });
};

export const createThinkingOrb = (
  canvas: HTMLCanvasElement,
  reducedMotion: MediaQueryList,
): (() => void) => {
  const context = canvas.getContext('2d');

  if (!context) {
    return (): void => undefined;
  }

  let animationFrame = 0;
  let running = false;
  let visible = true;
  let stopped = false;

  const render = (now: number) => {
    drawOrb(canvas, context, reducedMotion.matches ? .72 : now / 1000);
    if (running) {
      animationFrame = requestAnimationFrame(render);
    }
  };

  const stop = () => {
    running = false;
    cancelAnimationFrame(animationFrame);
  };

  const start = () => {
    if (running || stopped || reducedMotion.matches || !visible) {
      return;
    }

    running = true;
    animationFrame = requestAnimationFrame(render);
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') {
      stop();
    } else {
      start();
    }
  };

  const handleMotionPreference = () => {
    stop();
    render(performance.now());
    start();
  };

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible && document.visibilityState !== 'hidden') {
      start();
    } else {
      stop();
    }
  });

  observer.observe(canvas);
  document.addEventListener('visibilitychange', handleVisibility);
  reducedMotion.addEventListener('change', handleMotionPreference);
  render(performance.now());
  start();

  return () => {
    stopped = true;
    stop();
    observer.disconnect();
    document.removeEventListener('visibilitychange', handleVisibility);
    reducedMotion.removeEventListener('change', handleMotionPreference);
  };
};
