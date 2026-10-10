// Next's built-in offline font fixture. Screenshots use system fallback fonts;
// they are diagnostic captures, not approved visual baselines.
module.exports = new Proxy({}, { get: () => "/* latin */\n@font-face { font-family: 'Isolated Fixture Sans'; font-style: normal; font-weight: 100 900; src: url(/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf) format('truetype'); }" });
