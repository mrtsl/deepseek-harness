/**
 * SSH directory-picker surface, node half. Pure UI plugin: the empty apply
 * exists so the plugin appears in host Loader composition while the browser
 * half ships via exports["./client"].
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
