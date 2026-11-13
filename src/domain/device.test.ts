import { describe, expect, it } from 'vitest';
import { deviceName } from './device';

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

describe('deviceName', () => {
  it('names the browser and what it runs on', () => {
    expect(deviceName(`${MAC} Version/26.0 Safari/605.1.15`)).toBe('Safari on Mac');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36')).toBe('Chrome on Mac');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0')).toBe('Edge on Windows');
    expect(deviceName('Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0')).toBe('Firefox on Linux');
    expect(deviceName('Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36')).toBe('Chrome on Android');
  });
  it('knows an iPhone’s browsers apart, and an iPad from a Mac', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
    expect(deviceName(`${iphone} Version/26.0 Mobile/15E148 Safari/604.1`, 5)).toBe('Safari on iPhone');
    expect(deviceName(`${iphone} CriOS/141.0.0.0 Mobile/15E148 Safari/604.1`, 5)).toBe('Chrome on iPhone');
    expect(deviceName(`${MAC} Version/26.0 Safari/605.1.15`, 5)).toBe('Safari on iPad');
  });
  it('makes do with what it can tell', () => {
    expect(deviceName('')).toBe('Browser');
    expect(deviceName('SomeApp/1.0 (Windows)')).toBe('Browser on Windows');
  });
});
