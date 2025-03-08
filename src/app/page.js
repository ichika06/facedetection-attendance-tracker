"use client";

import dynamic from 'next/dynamic';

const FaceDetection = dynamic(() => import('./components/FaceDetection'), {
  ssr: false
});


export default function Home() {
  return (
      <FaceDetection />
  );
}
