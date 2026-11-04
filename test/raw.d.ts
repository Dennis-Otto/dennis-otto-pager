// The text of a file, as Vite imports it with ?raw, such as the manifest of the app.
declare module "*?raw" {
  const text: string;
  export default text;
}
