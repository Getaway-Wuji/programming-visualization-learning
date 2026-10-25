import { describe, expect, test, vi } from 'vitest';
import { withoutWorkspaceAudio } from '../../web/src/blocks/workspace';

describe('silent Blockly injection does not retain a browser API override', () => {
  test('returns the injected object and restores the exact own data descriptor', () => {
    const audio = vi.fn();
    const target = {};
    Object.defineProperty(target, 'AudioContext', {
      value: audio,
      configurable: true,
      enumerable: false,
      writable: false,
    });
    const before = Object.getOwnPropertyDescriptor(target, 'AudioContext');
    const workspace = { id: 'real-workspace-result' };
    expect(
      withoutWorkspaceAudio(() => {
        expect(Reflect.get(target, 'AudioContext')).toBeUndefined();
        return workspace;
      }, target),
    ).toBe(workspace);
    expect(Object.getOwnPropertyDescriptor(target, 'AudioContext')).toEqual(before);
    expect(Reflect.get(target, 'AudioContext')).toBe(audio);
    expect(audio).not.toHaveBeenCalled();
  });

  test('restores the exact descriptor before propagating a thrown injection error', () => {
    const target = {};
    Object.defineProperty(target, 'AudioContext', {
      value: function AudioContext() {},
      configurable: true,
      enumerable: true,
      writable: true,
    });
    const before = Object.getOwnPropertyDescriptor(target, 'AudioContext');
    const error = new Error('native Blockly injection failed');
    expect(() =>
      withoutWorkspaceAudio(() => {
        expect(Reflect.get(target, 'AudioContext')).toBeUndefined();
        throw error;
      }, target),
    ).toThrow(error);
    expect(Object.getOwnPropertyDescriptor(target, 'AudioContext')).toEqual(before);
  });

  test.each([false, true])('preserves an inherited constructor, including throw=%s', (throws) => {
    const audio = function AudioContext() {};
    const prototype = { AudioContext: audio };
    const target: object = Object.create(prototype);
    const originalPrototype = Object.getOwnPropertyDescriptors(prototype);
    const error = new Error('flyout injection failed');
    const inject = () =>
      withoutWorkspaceAudio(() => {
        expect(Object.hasOwn(target, 'AudioContext')).toBe(true);
        expect(Reflect.get(target, 'AudioContext')).toBeUndefined();
        if (throws) throw error;
        return 'injected';
      }, target);
    if (throws) expect(inject).toThrow(error);
    else expect(inject()).toBe('injected');
    expect(Object.hasOwn(target, 'AudioContext')).toBe(false);
    expect(Reflect.get(target, 'AudioContext')).toBe(audio);
    expect(Object.getOwnPropertyDescriptors(prototype)).toEqual(originalPrototype);
  });

  test('restores an own accessor without replacing it with a data property', () => {
    const target = {};
    const audio = function AudioContext() {};
    const getter = () => audio;
    const setter = vi.fn();
    Object.defineProperty(target, 'AudioContext', {
      get: getter,
      set: setter,
      configurable: true,
      enumerable: true,
    });
    const before = Object.getOwnPropertyDescriptor(target, 'AudioContext');
    withoutWorkspaceAudio(() => {
      expect(Reflect.get(target, 'AudioContext')).toBeUndefined();
    }, target);
    expect(Object.getOwnPropertyDescriptor(target, 'AudioContext')).toEqual(before);
    expect(Reflect.get(target, 'AudioContext')).toBe(audio);
    expect(setter).not.toHaveBeenCalled();
  });

  test.each([undefined, null, 'unsupported'])(
    'leaves a non-callable feature %s untouched while invoking injection once',
    (feature) => {
      const target = { AudioContext: feature };
      const before = Object.getOwnPropertyDescriptors(target);
      const inject = vi.fn(() => 42);
      expect(withoutWorkspaceAudio(inject, target)).toBe(42);
      expect(inject).toHaveBeenCalledTimes(1);
      expect(Object.getOwnPropertyDescriptors(target)).toEqual(before);
    },
  );

  test('does not create a feature property in an environment without AudioContext', () => {
    const target = {};
    expect(withoutWorkspaceAudio(() => 'silent', target)).toBe('silent');
    expect(Object.getOwnPropertyDescriptors(target)).toEqual({});
  });

  test('nested injection retains the outer mask and restores only the original descriptor', () => {
    const target = { AudioContext: function AudioContext() {} };
    const before = Object.getOwnPropertyDescriptor(target, 'AudioContext');
    expect(
      withoutWorkspaceAudio(() => {
        const masked = Object.getOwnPropertyDescriptor(target, 'AudioContext');
        expect(
          withoutWorkspaceAudio(() => {
            expect(Reflect.get(target, 'AudioContext')).toBeUndefined();
            return 'nested';
          }, target),
        ).toBe('nested');
        expect(Object.getOwnPropertyDescriptor(target, 'AudioContext')).toEqual(masked);
        expect(() =>
          withoutWorkspaceAudio(() => {
            throw new Error('nested failure');
          }, target),
        ).toThrow('nested failure');
        expect(Object.getOwnPropertyDescriptor(target, 'AudioContext')).toEqual(masked);
        return 'outer';
      }, target),
    ).toBe('outer');
    expect(Object.getOwnPropertyDescriptor(target, 'AudioContext')).toEqual(before);
  });

  test('rejects an unmaskable callable feature without starting injection or changing it', () => {
    const target = {};
    Object.defineProperty(target, 'AudioContext', {
      value: function AudioContext() {},
      configurable: false,
      writable: false,
      enumerable: true,
    });
    const before = Object.getOwnPropertyDescriptors(target);
    const inject = vi.fn();
    expect(() => withoutWorkspaceAudio(inject, target)).toThrow();
    expect(inject).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptors(target)).toEqual(before);
  });
});
