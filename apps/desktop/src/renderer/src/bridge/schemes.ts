import { PLUGIN_SCHEME, PROVIDER_SCHEME } from '@tessera/protocol';

const windowsStyle = /Windows/i.test(navigator.userAgent) || /Android/i.test(navigator.userAgent);

export function pluginUrl(pluginId: string, entry: string): string {
  return windowsStyle ? `http://${PLUGIN_SCHEME}.${pluginId}.localhost/${entry}` : `${PLUGIN_SCHEME}://${pluginId}/${entry}`;
}

export function providerUrl(pluginId: string, entry: string): string {
  return windowsStyle ? `http://${PROVIDER_SCHEME}.localhost/${pluginId}/${entry}` : `${PROVIDER_SCHEME}://localhost/${pluginId}/${entry}`;
}
