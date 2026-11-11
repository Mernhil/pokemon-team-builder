import { describe, expect, it } from 'vitest';
import { clientAddress, ipv6Prefix64 } from '../throttle';

const addr = (ip: string) => clientAddress(new Request('https://app.example/', { headers: { 'cf-connecting-ip': ip } }));

describe('clientAddress', () => {
  it('keeps an IPv4 address and shares one key without the header', () => {
    expect(addr('203.0.113.7')).toBe('203.0.113.7');
    expect(clientAddress(new Request('https://app.example/'))).toBe('unknown');
  });

  it('reduces IPv6 to the first 64 bits, also for compressed addresses', () => {
    expect(addr('2001:db8::abcd')).toBe('2001:db8:0:0');
    expect(addr('2001:DB8::1')).toBe(addr('2001:db8::ffff'));
    expect(addr('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2');
    expect(addr('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2');
    expect(addr('2001:db8:1::5:6:7')).toBe('2001:db8:1:0');
    expect(addr('2001:db8:1:2::9')).toBe('2001:db8:1:2');
    expect(addr('::1')).toBe('0:0:0:0');
    expect(addr('::')).toBe('0:0:0:0');
  });

  it('puts every host of one /64 in one bucket and other /64s in other buckets', () => {
    expect(addr('2001:db8:0:1::1')).toBe(addr('2001:db8:0:1:ffff::2'));
    expect(addr('2001:db8:0:1::1')).not.toBe(addr('2001:db8:0:2::1'));
  });

  it('handles an embedded IPv4 tail and leaves nonsense as it is', () => {
    expect(ipv6Prefix64('::ffff:1.2.3.4')).toBe('0:0:0:0');
    expect(ipv6Prefix64('1:2:3:4:5:6:1.2.3.4')).toBe('1:2:3:4');
    expect(ipv6Prefix64('not:an:ip')).toBe('not:an:ip');
    expect(ipv6Prefix64('1::2::3')).toBe('1::2::3');
  });
});
