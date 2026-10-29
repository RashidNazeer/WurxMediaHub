// Tailwind theme extension for PRISM. Usage: theme: { extend: require('./tailwind.prism.js') }
module.exports = {
  colors: {
    ink: '#14141C', mist: '#F7F7FB', line: '#ECECF3', body: '#4A4A5A', muted: '#6B6B7B', subtle: '#B9B9C8', 'ink-raised': '#2A2540',
    magenta: { DEFAULT: '#FF2E8C', tint: '#FFE6F1', on: '#B0145C' },
    violet: { DEFAULT: '#9B5CFF', tint: '#F3EEFF', on: '#5A1FD0' },
    blue: { DEFAULT: '#2E8BFF' },
    cyan: { DEFAULT: '#17E0D4', tint: '#E3FBF9', on: '#0B6F69' },
  },
  fontFamily: { display: ['Caprasimo', 'serif'], sans: ['Figtree', 'system-ui', 'sans-serif'] },
  borderRadius: { sm: '12px', md: '18px', lg: '24px', xl: '32px', icon: '48px' },
  boxShadow: { card: '0 1px 3px rgba(20,20,28,0.06)', raised: '0 12px 32px rgba(20,20,28,0.10)', float: '0 12px 32px rgba(20,20,28,0.18)' },
  backgroundImage: { stripe: 'linear-gradient(#17E0D4 0 25%, #2E8BFF 25% 50%, #9B5CFF 50% 75%, #FF2E8C 75%)' },
};
