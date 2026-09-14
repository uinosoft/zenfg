/** Shared destinations; rendering and deployment bases belong to each application. */
export const siteNavigation = [
    { id: 'home', text: 'Home', path: '' },
    { id: 'inspector', text: 'Inspector', path: 'inspector/' },
    { id: 'examples', text: 'Examples', path: 'playground/' },
    { id: 'docs', text: 'Docs', path: 'docs/' },
] as const;
