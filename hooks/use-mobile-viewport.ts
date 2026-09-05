'use client';
import { useEffect } from 'react';

// Keep full-screen dialogs inside the visible area when the phone keyboard opens.
export function useMobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const update = () => {
      root.style.setProperty('--visible-height', `${viewport?.height ?? window.innerHeight}px`);
      root.style.setProperty('--visible-top', `${viewport?.offsetTop ?? 0}px`);
      const focused = document.activeElement;
      const isEditing = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement;
      root.dataset.keyboardOpen = String(isEditing && window.innerHeight - (viewport?.height ?? window.innerHeight) > 120);
    };
    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update);
      root.style.removeProperty('--visible-height'); root.style.removeProperty('--visible-top'); delete root.dataset.keyboardOpen;
    };
  }, []);
}
