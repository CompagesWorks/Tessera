export default function createProvider({ base }) {
  return {
    name: 'ui-provider-demo',
    toast(kind, message) {
      base.toast(kind, `[demo] ${message}`);
    },
  };
}
