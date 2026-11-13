// A stand-in for the conversion of the manifest by GitHub, which
// test/register-app-script.mjs loads into scripts/register-app.mjs with
// `node --import`: it answers the POST to /app-manifests/CODE/conversions of the
// code "the-code" with the app of app.mjs, and fails with the status of
// STAND_IN_CONVERSION when that is set.
import { APP } from "./app.mjs";

const CONVERSION =
  /^https:\/\/api\.github\.com\/app-manifests\/([^/]+)\/conversions$/;

globalThis.fetch = async (url, init) => {
  const code = CONVERSION.exec(String(url))?.[1];
  if (code === undefined || init?.method !== "POST") {
    throw new Error(`No stand-in for ${init?.method ?? "GET"} ${url}`);
  }
  const status = Number(process.env.STAND_IN_CONVERSION ?? "201");
  if (code !== "the-code" || status >= 400) {
    return new Response('{"message":"Not Found"}', {
      status: code === "the-code" ? status : 404,
    });
  }
  return Response.json(APP, { status });
};
