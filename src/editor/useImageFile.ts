import { useCallback, useEffect, useRef, useState } from "react";

/** 이 이상은 텍스처로도, 저작 캔버스로도 감당이 안 된다. */
export const MAX_IMAGE_EDGE = 8000;

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface LoadedImage {
  element: HTMLImageElement;
  name: string;
  width: number;
  height: number;
}

/** 디코딩 전에 알 수 있는 거절 사유만 본다. 통과면 null. */
export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "PNG · JPEG · WebP 이미지만 불러올 수 있습니다.";
  }
  return null;
}

export interface ImageFileState {
  image: LoadedImage | null;
  error: string | null;
  loadFile: (file: File) => void;
}

/**
 * 파일 → 디코딩된 <img>. 오브젝트 URL은 다음 이미지가 성공했을 때만 회수한다
 * (먼저 회수하면 화면에 걸린 미리보기가 깨진다).
 */
export function useImageFile(): ImageFileState {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  const loadFile = useCallback((file: File): void => {
    const rejected = validateImageFile(file);
    if (rejected) {
      setError(rejected);
      return;
    }

    const url = URL.createObjectURL(file);
    const element = new Image();

    const fail = (message: string): void => {
      URL.revokeObjectURL(url);
      setError(message);
    };

    element.onload = () => {
      const width = element.naturalWidth || element.width;
      const height = element.naturalHeight || element.height;
      if (!(width > 0) || !(height > 0)) {
        fail("이미지 크기를 읽지 못했습니다.");
        return;
      }
      if (Math.max(width, height) > MAX_IMAGE_EDGE) {
        fail(`이미지 한 변이 ${MAX_IMAGE_EDGE}px를 넘습니다 (${width}×${height}).`);
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setError(null);
      setImage({ element, name: file.name, width, height });
    };

    element.onerror = () => fail("이미지를 읽지 못했습니다. 파일이 손상되었을 수 있습니다.");
    element.src = url;
  }, []);

  return { image, error, loadFile };
}
