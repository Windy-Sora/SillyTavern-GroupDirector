/** Browser-only geometry; no chat, task or model state. */
export function visibleViewport(win, insets = {}) {
    const visual = win.visualViewport;
    const width = visual?.width > 0 ? visual.width : win.innerWidth;
    const height = visual?.height > 0 ? visual.height : win.innerHeight;
    const left = Math.max(0, insets.left || 0), top = Math.max(0, insets.top || 0);
    return { x: (visual?.offsetLeft || 0) + left, y: (visual?.offsetTop || 0) + top,
        width: Math.max(1, width - left - Math.max(0, insets.right || 0)),
        height: Math.max(1, height - top - Math.max(0, insets.bottom || 0)) };
}

export function isMobileViewport(win) {
    return win.innerWidth <= 600 || (win.innerWidth <= 900 && win.matchMedia?.('(pointer: coarse)').matches === true);
}

export function validBallPosition(value) {
    return value && ['left', 'right'].includes(value.side) && Number.isFinite(value.fraction) && value.fraction >= 0 && value.fraction <= 1
        ? { side: value.side, fraction: value.fraction } : { side: 'right', fraction: 0.9 };
}

export function dockedBallRect(position, viewport, tucked = false) {
    const { side, fraction } = validBallPosition(position), size = 48, x = viewport.x || 0, y = viewport.y || 0;
    return { width: size, height: size,
        x: side === 'left' ? x + 8 - (tucked ? 24 : 0) : x + Math.max(8, viewport.width - size - 8) + (tucked ? 24 : 0),
        y: y + 8 + Math.max(0, viewport.height - size - 16) * fraction };
}
