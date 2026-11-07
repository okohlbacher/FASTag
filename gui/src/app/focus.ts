// Focus a control once the render that brings it has happened.
export const focusLater = (el: () => HTMLElement | null | undefined): void => {
  setTimeout(() => el()?.focus())
}

// Focus fell to the page body: nothing, or a control that was hidden or
// disabled while it had focus.
export const focusLost = (): boolean => {
  const a = document.activeElement
  return !a || a === document.body || !!a.closest('[hidden]') || (a as HTMLButtonElement).disabled === true
}
