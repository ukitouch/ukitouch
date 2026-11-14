import dts from 'rollup-plugin-dts'

export default {
  input: 'src/api/index.ts',
  output: {
    file: 'dist/api.d.ts',
    format: 'es'
  },
  plugins: [dts()]
}