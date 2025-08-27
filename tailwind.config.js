/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Color-blind safe palette colors
        'viz-blue': '#0173B2',
        'viz-orange': '#DE8F05',
        'viz-green': '#029E73',
        'viz-yellow': '#CC78BC',
        'viz-red': '#EC7014',
        'viz-purple': '#949494',
      },
      animation: {
        'blossom': 'blossom 0.3s ease-out',
        'fadeIn': 'fadeIn 0.2s ease-in',
      },
      keyframes: {
        blossom: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        }
      }
    },
  },
  plugins: [],
}