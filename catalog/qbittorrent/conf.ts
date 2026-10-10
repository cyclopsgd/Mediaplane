import { pbkdf2Sync } from 'node:crypto';
import type { ConfigFileContext } from '@mediaplane/engine';

/**
 * qBittorrent's WebUI\Password_PBKDF2 value (design §6.1): PBKDF2-HMAC-SHA512 with
 * 100 000 iterations, a 16-byte salt and a 64-byte key, as "@ByteArray(<salt>:<key>)" in
 * base64.
 */
export function passwordHash(password: string, salt: Buffer): string {
  const key = pbkdf2Sync(password, salt, 100_000, 64, 'sha512');
  return `@ByteArray(${salt.toString('base64')}:${key.toString('base64')})`;
}

/**
 * qBittorrent.conf, written before qBittorrent first starts (design §6.1, §6.4).
 * qBittorrent keeps these settings and adds its own. Without this file, the image starts
 * with a new temporary password every time.
 *
 * Nothing here is escaped, because every interpolated value is already limited to safe
 * characters: the user name (3 to 32 letters, digits, ".", "_" or "-"), the generated key
 * ("qbt_" and 28 letters and digits), the subnets (IPv4 CIDRs) and the password's hash
 * (base64). The password itself is never written.
 */
export function qbittorrentConf<Options>(ctx: ConfigFileContext<Options>): string {
  // The LAN may skip the login only when you said so, and only if the UI is on the LAN
  // (lanClientSubnets is empty otherwise).
  const whitelist = ctx.config.security.login_on_lan ? [] : ctx.lanClientSubnets;
  return [
    '[BitTorrent]',
    'Session\\DefaultSavePath=/data/torrents/',
    // Automatic Torrent Management: a torrent follows its category's save path.
    'Session\\DisableAutoTMMByDefault=false',
    '',
    '[LegalNotice]',
    'Accepted=true',
    '',
    '[Preferences]',
    'Connection\\UPnP=false',
    `WebUI\\APIKey=${ctx.secret('apiKey')}`,
    'WebUI\\Address=*',
    // A comma with no space: qBittorrent would keep a space as part of the next subnet.
    ...(whitelist.length === 0
      ? ['WebUI\\AuthSubnetWhitelistEnabled=false']
      : [
          `WebUI\\AuthSubnetWhitelist=${whitelist.join(',')}`,
          'WebUI\\AuthSubnetWhitelistEnabled=true',
        ]),
    'WebUI\\LocalHostAuth=true',
    `WebUI\\Password_PBKDF2="${passwordHash(ctx.admin.password, ctx.random(16))}"`,
    'WebUI\\ServerDomains=*',
    `WebUI\\Username=${ctx.admin.username}`,
    '',
  ].join('\n');
}
