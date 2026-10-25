import * as Blockly from 'blockly/core';

export type BlockInteractionState = 'idle' | 'dragging' | 'preview' | 'edge';

const SNAP_CSS_PIXELS = 28;
const EDGE_CSS_PIXELS = 40;
const EDGE_PIXELS_PER_SECOND = 320;
const MAX_FRAME_MS = 32;
const Coordinate = Blockly.utils.Coordinate;

/** Workspace-local hooks. Native Blockly still chooses, checks and connects
 * candidates, groups undo events, clones flyout blocks and handles deletion. */
export function blockInteractionPlugins(
  onState: (state: BlockInteractionState) => void,
): NonNullable<Blockly.BlocklyOptions['plugins']> {
  let state: BlockInteractionState = 'idle';
  let dragging = false;
  let preview = false;
  let edge = false;
  const publish = () => {
    const next = !dragging ? 'idle' : edge ? 'edge' : preview ? 'preview' : 'dragging';
    if (next === state) return;
    state = next;
    onState(next);
  };

  class TeachingStrategy extends Blockly.dragging.BlockDragStrategy {
    protected override getSearchRadius(): number {
      const native = super.getSearchRadius();
      // Keyboard constrained moves deliberately search the complete workspace.
      if (!Number.isFinite(native)) return native;
      const scale = this.workspace.scale;
      return Number.isFinite(scale) && scale > 0 ? SNAP_CSS_PIXELS / scale : native;
    }

    protected override getTargetBlock(): Blockly.BlockSvg {
      const target = super.getTargetBlock();
      // A flyout clone starts dragging synchronously, before CREATE listeners.
      if (target !== this.block) target.setDragStrategy(new TeachingStrategy(target));
      return target;
    }
  }

  class TeachingPreviewer extends Blockly.InsertionMarkerPreviewer {
    private updating = false;

    override previewConnection(
      local: Blockly.RenderedConnection,
      neighbour: Blockly.RenderedConnection,
    ): void {
      this.updating = true;
      try {
        super.previewConnection(local, neighbour);
      } finally {
        this.updating = false;
      }
      preview = true;
      publish();
    }

    override previewReplacement(
      local: Blockly.RenderedConnection,
      neighbour: Blockly.RenderedConnection,
      replaced: Blockly.BlockSvg,
    ): void {
      this.updating = true;
      try {
        super.previewReplacement(local, neighbour, replaced);
      } finally {
        this.updating = false;
      }
      preview = true;
      publish();
    }

    override hidePreview(): void {
      super.hidePreview();
      // The native previewer clears the old candidate inside preview methods.
      // Do not report a transient disappearance for every pointer movement.
      if (this.updating) return;
      preview = false;
      publish();
    }

    override dispose(): void {
      super.dispose();
      preview = false;
      publish();
    }
  }

  class TeachingDragger extends Blockly.dragging.Dragger {
    private active = false;
    private frame = 0;
    private frameTime = 0;
    private startScroll = new Coordinate(0, 0);
    private lastDelta = new Coordinate(0, 0);
    private pointer: PointerEvent | null = null;
    private visibilityObserver: ResizeObserver | null = null;

    override onDragStart(event?: PointerEvent | KeyboardEvent): Blockly.IDraggable {
      if (this.draggable instanceof Blockly.BlockSvg)
        this.draggable.setDragStrategy(new TeachingStrategy(this.draggable));
      this.active = true;
      dragging = true;
      preview = false;
      edge = false;
      publish();
      try {
        const target = super.onDragStart(event);
        const workspace = this.draggable.workspace;
        this.startScroll = new Coordinate(workspace.scrollX, workspace.scrollY);
        window.addEventListener('blur', this.suspend);
        document.addEventListener('visibilitychange', this.visibilityChanged);
        document.addEventListener('pointercancel', this.suspend);
        const svg = workspace.getParentSvg();
        this.visibilityObserver = new ResizeObserver(() => {
          const bounds = svg.getBoundingClientRect();
          if (!svg.isConnected || bounds.width <= 0 || bounds.height <= 0) this.suspend();
        });
        this.visibilityObserver.observe(svg);
        return target;
      } catch (error) {
        this.finish();
        throw error;
      }
    }

    override onDrag(
      event: PointerEvent | KeyboardEvent | undefined,
      totalDelta: Blockly.utils.Coordinate,
    ): void {
      if (!this.active) return;
      if (event instanceof PointerEvent && !(event.buttons & 1)) {
        this.suspend();
        return;
      }
      this.lastDelta = totalDelta.clone();
      super.onDrag(event, totalDelta);
      this.pointer = event instanceof PointerEvent ? event : null;
      if (this.velocity()) {
        if (!this.frame) {
          this.frameTime = 0;
          this.frame = requestAnimationFrame(this.pan);
        }
      } else this.stopPanning();
    }

    protected override pixelsToWorkspaceUnits(
      delta: Blockly.utils.Coordinate,
    ): Blockly.utils.Coordinate {
      const workspace = this.draggable.workspace;
      // Use actual clamped scrolling, never requested velocity, so the grabbed
      // point remains under the pointer even at a native content boundary.
      return super.pixelsToWorkspaceUnits(
        new Coordinate(
          delta.x + this.startScroll.x - workspace.scrollX,
          delta.y + this.startScroll.y - workspace.scrollY,
        ),
      );
    }

    private velocity(): Blockly.utils.Coordinate | null {
      const workspace = this.draggable.workspace;
      const event = this.pointer;
      if (
        !this.active ||
        !event ||
        !event.isPrimary ||
        !(event.buttons & 1) ||
        document.visibilityState === 'hidden' ||
        !workspace.rendered ||
        !(this.draggable instanceof Blockly.BlockSvg) ||
        this.draggable.isDeadOrDying()
      )
        return null;
      const svg = workspace.getParentSvg();
      if (!svg.isConnected || getComputedStyle(svg).visibility === 'hidden') return null;
      const bounds = svg.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return null;
      const metrics = workspace.getMetrics();
      const viewportLeft = bounds.left + metrics.absoluteLeft;
      const viewportTop = bounds.top + metrics.absoluteTop;
      // The canvas can extend below the page fold. Use its visible intersection
      // with the browser viewport so a held pointer can reach the next area.
      const left = Math.max(0, viewportLeft);
      const top = Math.max(0, viewportTop);
      const right = Math.min(window.innerWidth, viewportLeft + metrics.viewWidth);
      const bottom = Math.min(window.innerHeight, viewportTop + metrics.viewHeight);
      if (
        event.clientX < left ||
        event.clientX > right ||
        event.clientY < top ||
        event.clientY > bottom ||
        workspace.getDragTarget(event)
      )
        return null;
      const axis = (position: number, start: number, end: number) => {
        const band = Math.min(EDGE_CSS_PIXELS, (end - start) / 2);
        if (band <= 0) return 0;
        if (position < start + band)
          return -EDGE_PIXELS_PER_SECOND * (1 - (position - start) / band);
        if (position > end - band) return EDGE_PIXELS_PER_SECOND * (1 - (end - position) / band);
        return 0;
      };
      const x = workspace.isMovableHorizontally() ? axis(event.clientX, left, right) : 0;
      const y = workspace.isMovableVertically() ? axis(event.clientY, top, bottom) : 0;
      return x || y ? new Coordinate(x, y) : null;
    }

    private pan = (time: number): void => {
      this.frame = 0;
      const velocity = this.velocity();
      if (!velocity || !this.pointer) {
        this.stopPanning();
        return;
      }
      const dt = Math.min(MAX_FRAME_MS, this.frameTime ? time - this.frameTime : 16);
      this.frameTime = time;
      const workspace = this.draggable.workspace;
      const beforeX = workspace.scrollX;
      const beforeY = workspace.scrollY;
      workspace.scroll(
        beforeX - (velocity.x * dt) / 1000,
        beforeY - (velocity.y * dt) / 1000,
        false,
      );
      if (beforeX === workspace.scrollX && beforeY === workspace.scrollY) {
        this.stopPanning();
        return;
      }
      edge = true;
      publish();
      super.onDrag(this.pointer, this.lastDelta);
      this.frame = requestAnimationFrame(this.pan);
    };

    private stopPanning(): void {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.frameTime = 0;
      edge = false;
      publish();
    }

    private finish(): void {
      this.active = false;
      this.pointer = null;
      dragging = false;
      preview = false;
      this.stopPanning();
      this.visibilityObserver?.disconnect();
      this.visibilityObserver = null;
      window.removeEventListener('blur', this.suspend);
      document.removeEventListener('visibilitychange', this.visibilityChanged);
      document.removeEventListener('pointercancel', this.suspend);
    }

    private suspend = (): void => {
      if (!this.active) return;
      const workspace = this.draggable.workspace;
      // Pinned Blockly13.4 exposes this class method in its declarations, but
      // marks it @internal in source. Let its Gesture own native cancellation
      // as well, so returning after a lost release cannot keep moving blocks.
      this.finish();
      workspace.cancelCurrentGesture();
    };
    private visibilityChanged = (): void => {
      if (document.visibilityState === 'hidden') this.suspend();
    };

    override onDragEnd(event?: PointerEvent | KeyboardEvent): void {
      this.finish();
      super.onDragEnd(event);
    }

    override onDragRevert(event?: PointerEvent | KeyboardEvent): void {
      this.finish();
      super.onDragRevert(event);
    }
  }

  return {
    [Blockly.registry.Type.BLOCK_DRAGGER.toString()]: TeachingDragger,
    [Blockly.registry.Type.CONNECTION_PREVIEWER.toString()]: TeachingPreviewer,
  };
}
