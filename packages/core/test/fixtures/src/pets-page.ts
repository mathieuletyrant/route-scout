import { useListPets, useGetPetById, createPet } from '../generated/pets';

export function PetsPage() {
  const pets = useListPets();
  const pet = useGetPetById('42');
  const onCreate = () => createPet({ name: 'Rex' });
  return { pets, pet, onCreate };
}
