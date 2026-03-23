import type { BCFMarker3D, BCFOverlayProjection, BCFOverlayRendererOptions } from "../types/bcf";

const MARKER_CLASS = "bcf-overlay-marker";
const CONNECTOR_CLASS = "bcf-overlay-connector";
const ACTIVE_CLASS = "bcf-overlay-active";
const TOOLTIP_CLASS = "bcf-overlay-tooltip";

const PRIORITY_COLORS: Record<string, string> = {
  high: "#f7768e",
  critical: "#f7768e",
  medium: "#ff9e64",
  normal: "#ff9e64",
  low: "#9ece6a",
};

const STATUS_ICONS: Record<string, string> = {
  open: "●",
  "in progress": "◐",
  resolved: "✓",
  closed: "○",
};

function isResolvedStatus(status: string) {
  const normalized = status.trim().toLowerCase();
  return normalized === "resolved" || normalized === "closed" || normalized === "done";
}

export class BCFOverlayRenderer {
  private container: HTMLDivElement;
  private svgLayer: SVGSVGElement;
  private markerElements = new Map<string, HTMLDivElement>();
  private connectorElements = new Map<string, SVGLineElement>();
  private markers: BCFMarker3D[] = [];
  private activeMarkerId: string | null = null;
  private projection: BCFOverlayProjection;
  private unsubCamera: (() => void) | null = null;
  private clickCallbacks: Array<(topicGuid: string) => void> = [];
  private hoverCallbacks: Array<(topicGuid: string | null) => void> = [];
  private opts: Required<BCFOverlayRendererOptions>;
  private visible = true;
  private disposed = false;
  private static stylesInjected = false;

  constructor(parentElement: HTMLElement, projection: BCFOverlayProjection, options?: BCFOverlayRendererOptions) {
    this.projection = projection;
    this.opts = {
      showConnectors: options?.showConnectors ?? true,
      showTooltips: options?.showTooltips ?? true,
      minScale: options?.minScale ?? 0.65,
      maxScale: options?.maxScale ?? 1.0,
      verticalOffset: options?.verticalOffset ?? 36,
    };

    this.container = document.createElement("div");
    this.container.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:20;";
    parentElement.appendChild(this.container);

    this.svgLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svgLayer.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;";
    this.container.appendChild(this.svgLayer);

    this.injectStyles();
    this.unsubCamera = projection.onCameraChange(() => this.updatePositions());
  }

  setMarkers(markers: BCFMarker3D[]) {
    this.markers = markers;
    const newGuids = new Set(markers.map((marker) => marker.topicGuid));

    for (const [guid, el] of this.markerElements) {
      if (!newGuids.has(guid)) {
        el.remove();
        this.markerElements.delete(guid);
      }
    }

    for (const [guid, el] of this.connectorElements) {
      if (!newGuids.has(guid)) {
        el.remove();
        this.connectorElements.delete(guid);
      }
    }

    for (const marker of markers) {
      if (!this.markerElements.has(marker.topicGuid)) {
        this.createMarkerElement(marker);
      } else {
        this.updateMarkerContent(marker);
      }
    }

    this.updatePositions();
  }

  setActiveMarker(topicGuid: string | null) {
    if (this.activeMarkerId) {
      this.markerElements.get(this.activeMarkerId)?.classList.remove(ACTIVE_CLASS);
    }

    this.activeMarkerId = topicGuid;

    if (topicGuid) {
      this.markerElements.get(topicGuid)?.classList.add(ACTIVE_CLASS);
    }
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.container.style.display = visible ? "" : "none";
  }

  onMarkerClick(callback: (topicGuid: string) => void) {
    this.clickCallbacks.push(callback);
    return () => {
      this.clickCallbacks = this.clickCallbacks.filter((candidate) => candidate !== callback);
    };
  }

  onMarkerHover(callback: (topicGuid: string | null) => void) {
    this.hoverCallbacks.push(callback);
    return () => {
      this.hoverCallbacks = this.hoverCallbacks.filter((candidate) => candidate !== callback);
    };
  }

  updatePositions() {
    if (this.disposed || !this.visible) {
      return;
    }

    const { width, height } = this.projection.getCanvasSize();
    if (width === 0 || height === 0) {
      return;
    }

    const cameraPosition = this.projection.getCameraPosition?.();

    for (const marker of this.markers) {
      const el = this.markerElements.get(marker.topicGuid);
      if (!el) {
        continue;
      }

      const markerScreen = this.projection.projectToScreen(marker.position);
      if (
        !markerScreen ||
        markerScreen.x < -80 ||
        markerScreen.y < -80 ||
        markerScreen.x > width + 80 ||
        markerScreen.y > height + 80
      ) {
        el.style.display = "none";
        this.connectorElements.get(marker.topicGuid)?.style.setProperty("display", "none");
        continue;
      }

      el.style.display = "";

      let scale = 1;
      if (cameraPosition) {
        const dx = marker.position.x - cameraPosition.x;
        const dy = marker.position.y - cameraPosition.y;
        const dz = marker.position.z - cameraPosition.z;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const normalizedDistance = Math.max(0, Math.min(1, (distance - 20) / 180));
        scale = this.opts.maxScale + normalizedDistance * (this.opts.minScale - this.opts.maxScale);
      }

      const markerX = markerScreen.x;
      const markerY = markerScreen.y;
      el.style.transform = `translate(${markerX}px, ${markerY}px) translate(-50%, -100%) scale(${scale.toFixed(3)})`;

      const opacity = cameraPosition
        ? 0.6 +
          (1 -
            Math.max(
              0,
              Math.min(
                1,
                (Math.sqrt(
                  (marker.position.x - cameraPosition.x) ** 2 +
                    (marker.position.y - cameraPosition.y) ** 2 +
                    (marker.position.z - cameraPosition.z) ** 2,
                ) -
                  20) /
                  250,
              ),
            )) *
            0.4
        : 1;
      el.style.opacity = opacity.toFixed(2);

      if (!this.opts.showConnectors) {
        continue;
      }

      const anchor = marker.connectorAnchor ?? marker.position;
      const anchorScreen = this.projection.projectToScreen(anchor);

      let connector = this.connectorElements.get(marker.topicGuid);
      if (!connector) {
        connector = document.createElementNS("http://www.w3.org/2000/svg", "line");
        connector.classList.add(CONNECTOR_CLASS);
        this.svgLayer.appendChild(connector);
        this.connectorElements.set(marker.topicGuid, connector);
      }

      if (!anchorScreen) {
        connector.style.display = "none";
        continue;
      }

      const color = this.getMarkerColor(marker);
      connector.style.display = "";
      connector.setAttribute("x1", String(markerX));
      connector.setAttribute("y1", String(markerY));
      connector.setAttribute("x2", String(anchorScreen.x));
      connector.setAttribute("y2", String(anchorScreen.y));
      connector.setAttribute("stroke", color);
      connector.setAttribute("stroke-width", "1.5");
      connector.setAttribute("stroke-dasharray", "3 2");
      connector.setAttribute("stroke-opacity", String((opacity * 0.5).toFixed(2)));
    }
  }

  dispose() {
    this.disposed = true;
    this.unsubCamera?.();
    this.container.remove();
    this.markerElements.clear();
    this.connectorElements.clear();
    this.clickCallbacks = [];
    this.hoverCallbacks = [];
  }

  private createMarkerElement(marker: BCFMarker3D) {
    const el = document.createElement("div");
    el.className = MARKER_CLASS;
    el.dataset.topicGuid = marker.topicGuid;
    this.updateMarkerInnerHTML(el, marker);

    el.addEventListener("click", (event) => {
      event.stopPropagation();
      this.clickCallbacks.forEach((callback) => callback(marker.topicGuid));
    });

    el.addEventListener("mouseenter", () => {
      this.hoverCallbacks.forEach((callback) => callback(marker.topicGuid));
      const tooltip = el.querySelector<HTMLElement>(`.${TOOLTIP_CLASS}`);
      if (tooltip) {
        tooltip.style.display = "";
      }
    });

    el.addEventListener("mouseleave", () => {
      this.hoverCallbacks.forEach((callback) => callback(null));
      const tooltip = el.querySelector<HTMLElement>(`.${TOOLTIP_CLASS}`);
      if (tooltip) {
        tooltip.style.display = "none";
      }
    });

    if (marker.topicGuid === this.activeMarkerId) {
      el.classList.add(ACTIVE_CLASS);
    }

    this.container.appendChild(el);
    this.markerElements.set(marker.topicGuid, el);
  }

  private updateMarkerContent(marker: BCFMarker3D) {
    const el = this.markerElements.get(marker.topicGuid);
    if (!el) {
      return;
    }

    this.updateMarkerInnerHTML(el, marker);

    if (marker.topicGuid === this.activeMarkerId) {
      el.classList.add(ACTIVE_CLASS);
    } else {
      el.classList.remove(ACTIVE_CLASS);
    }
  }

  private updateMarkerInnerHTML(el: HTMLDivElement, marker: BCFMarker3D) {
    const color = this.getMarkerColor(marker);
    const statusIcon = STATUS_ICONS[marker.status.trim().toLowerCase()] ?? "●";

    el.innerHTML = `
      <div class="bcf-marker-pin" style="--marker-color:${color};">
        <span class="bcf-marker-index">${marker.index}</span>
      </div>
      <div class="${TOOLTIP_CLASS}" style="display:none;">
        <div class="bcf-tooltip-header">
          <span class="bcf-tooltip-status" style="color:${color}">${statusIcon}</span>
          <span class="bcf-tooltip-title">${this.escapeHtml(marker.title)}</span>
        </div>
        <div class="bcf-tooltip-meta">
          ${this.escapeHtml(marker.status)}${marker.commentCount > 0 ? ` · ${marker.commentCount} comment${marker.commentCount !== 1 ? "s" : ""}` : ""}
        </div>
      </div>
    `;
  }

  private getPriorityColor(priority: string) {
    return PRIORITY_COLORS[priority.trim().toLowerCase()] ?? "#7aa2f7";
  }

  private getMarkerColor(marker: Pick<BCFMarker3D, "status" | "priority">) {
    if (isResolvedStatus(marker.status)) {
      return "#8b93a6";
    }

    return this.getPriorityColor(marker.priority);
  }

  private escapeHtml(text: string) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private injectStyles() {
    if (BCFOverlayRenderer.stylesInjected) {
      return;
    }

    BCFOverlayRenderer.stylesInjected = true;

    const style = document.createElement("style");
    style.textContent = `
      .${MARKER_CLASS} {
        position: absolute;
        left: 0;
        top: 0;
        pointer-events: auto;
        cursor: pointer;
        will-change: transform, opacity;
        z-index: 21;
        filter: drop-shadow(0 2px 6px rgba(0,0,0,0.35));
        transform-origin: center bottom;
      }

      .bcf-marker-pin {
        width: 28px;
        height: 28px;
        border-radius: 50% 50% 50% 0;
        background: var(--marker-color, #7aa2f7);
        transform: rotate(-45deg);
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid rgba(255,255,255,0.9);
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }

      .${MARKER_CLASS}:hover .bcf-marker-pin {
        transform: rotate(-45deg) scale(1.2);
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      }

      .${ACTIVE_CLASS} .bcf-marker-pin {
        transform: rotate(-45deg) scale(1.25);
        box-shadow: 0 0 0 4px rgba(122,162,247,0.35), 0 4px 16px rgba(0,0,0,0.4);
        animation: bcf-pulse 1.8s ease-in-out infinite;
      }

      .bcf-marker-index {
        transform: rotate(45deg);
        font-size: 11px;
        font-weight: 700;
        color: white;
        font-family: ui-monospace, monospace;
        line-height: 1;
        user-select: none;
      }

      .${TOOLTIP_CLASS} {
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        background: #1a1b26;
        color: #a9b1d6;
        border: 1px solid #3b4261;
        padding: 8px 12px;
        min-width: 160px;
        max-width: 260px;
        font-family: ui-monospace, monospace;
        font-size: 11px;
        line-height: 1.4;
        white-space: nowrap;
        z-index: 100;
        pointer-events: none;
        box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      }

      .${TOOLTIP_CLASS}::after {
        content: "";
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 5px solid transparent;
        border-top-color: #3b4261;
      }

      .bcf-tooltip-header {
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .bcf-tooltip-status {
        font-size: 10px;
        flex-shrink: 0;
      }

      .bcf-tooltip-title {
        font-weight: 600;
        color: #c0caf5;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .bcf-tooltip-meta {
        margin-top: 3px;
        font-size: 10px;
        color: #565f89;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .${CONNECTOR_CLASS} {
        pointer-events: none;
      }

      @keyframes bcf-pulse {
        0%, 100% { box-shadow: 0 0 0 4px rgba(122,162,247,0.35), 0 4px 16px rgba(0,0,0,0.4); }
        50% { box-shadow: 0 0 0 8px rgba(122,162,247,0.1), 0 4px 16px rgba(0,0,0,0.4); }
      }
    `;

    document.head.appendChild(style);
  }
}
