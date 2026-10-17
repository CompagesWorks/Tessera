const t = (key, params) => tessera.i18n.t(key, params);
const OUTPUTS = ['png', 'dds', 'nutexb'];
const FORMATS = [
  'BC7RgbaUnormSrgb',
  'BC7RgbaUnorm',
  'BC1RgbaUnormSrgb',
  'BC1RgbaUnorm',
  'BC2RgbaUnormSrgb',
  'BC2RgbaUnorm',
  'BC3RgbaUnormSrgb',
  'BC3RgbaUnorm',
  'BC4RUnorm',
  'BC4RSnorm',
  'BC5RgUnorm',
  'BC5RgSnorm',
  'BC6hRgbUfloat',
  'BC6hRgbSfloat',
  'Rgba8UnormSrgb',
  'Rgba8Unorm',
  'Bgra8UnormSrgb',
  'Bgra8Unorm',
];
const MIPMAPS = [
  ['GeneratedAutomatic', 'mipmaps.generate'],
  ['FromSurface', 'mipmaps.fromFile'],
  ['Disabled', 'mipmaps.none'],
];
