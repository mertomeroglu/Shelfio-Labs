import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LocationLayoutEditableCanvas, {
  updateInteractiveItem,
} from './LocationLayoutEditableCanvas.jsx';

globalThis.PointerEvent ??= MouseEvent;

describe('LocationLayoutEditableCanvas interaction updates', () => {
  const items = [
    { id: 'section-1', x: 20, y: 30, width: 40, height: 120 },
    { id: 'shelf-1', x: 80, y: 50, width: 60, height: 20 },
  ];

  it('moves only the active item and preserves other item references', () => {
    const next = updateInteractiveItem({
      items,
      interaction: {
        type: 'dragging',
        itemId: 'section-1',
        startX: 100,
        startY: 100,
        initialItemX: 20,
        initialItemY: 30,
      },
      clientX: 127,
      clientY: 144,
      zoom: 1,
      snapEnabled: true,
      gridSize: 10,
    });

    expect(next[0]).toMatchObject({ x: 50, y: 70 });
    expect(next[0]).not.toBe(items[0]);
    expect(next[1]).toBe(items[1]);
  });

  it('resizes with zoom-aware deltas and minimum dimensions', () => {
    const next = updateInteractiveItem({
      items,
      interaction: {
        type: 'resizing',
        itemId: 'shelf-1',
        startX: 100,
        startY: 100,
        initialItemW: 60,
        initialItemH: 20,
      },
      clientX: 140,
      clientY: 60,
      zoom: 2,
      snapEnabled: false,
      gridSize: 10,
    });

    expect(next[1]).toMatchObject({ width: 80, height: 10 });
    expect(next[0]).toBe(items[0]);
  });

  it('commits one history snapshot when a drag finishes', () => {
    const onChangeItems = vi.fn();
    const onCommitItems = vi.fn();
    const requestAnimationFrame = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockReturnValue(1);
    const cancelAnimationFrame = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => {});
    const editableItems = items.map((item, index) => ({
      ...item,
      objectType: index === 0 ? 'section' : 'shelf',
      label: item.id,
      metadata: {},
    }));
    const { container, unmount } = render(React.createElement(LocationLayoutEditableCanvas, {
      items: editableItems,
      selectedObjectId: 'section-1',
      onSelectObject: vi.fn(),
      onChangeItems,
      onCommitItems,
      setZoom: vi.fn(),
      setPan: vi.fn(),
    }));
    const object = container.querySelector('.lm-plan-object-section');
    const canvas = container.querySelector('.lm-layout-canvas-wrapper');

    fireEvent.pointerDown(object, {
      button: 0,
      pointerId: 7,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 7,
      clientX: 140,
      clientY: 120,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 7,
      clientX: 140,
      clientY: 120,
    });

    expect(onChangeItems).toHaveBeenCalledTimes(1);
    expect(onCommitItems).toHaveBeenCalledTimes(1);
    expect(onCommitItems.mock.calls[0][1]).toBe(editableItems);

    unmount();
    requestAnimationFrame.mockRestore();
    cancelAnimationFrame.mockRestore();
  });
});
