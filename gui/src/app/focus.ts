// Focus a control once the render that brings it has happened.
export const focusLater = (el: () => HTMLElement | null | undefined): void => {
  setTimeout(() => el()?.focus())
}
