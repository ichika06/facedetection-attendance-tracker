import http from "http";
import { NextResponse } from "next/server";

export async function GET() {
  const streamUrl = "http://192.168.1.10/stream";

  return new Promise((resolve, reject) => {
    http.get(streamUrl, (res) => {
      if (res.statusCode !== 200) {
        reject(new NextResponse(JSON.stringify({ error: "Stream error" }), { status: 500 }));
      }

      resolve(new Response(res, {
        headers: {
          "Content-Type": "multipart/x-mixed-replace; boundary=frame",
          "Access-Control-Allow-Origin": "*",
        },
      }));
    }).on("error", (err) => {
      console.error("Stream fetch error:", err);
      reject(new NextResponse(JSON.stringify({ error: "Failed to fetch the stream" }), { status: 500 }));
    });
  });
}
