import { deletePet } from '../generated/pets';

export const removePet = (id: string) => deletePet(id);

// A raw fetch call site, matched only by a regex matcher.
export const rawList = () => fetch('/pets', { method: 'GET' });
