// Llave PÚBLICA de MN Scents para comprobar los enlaces de acceso al catálogo de reventa.
// Es pública a propósito: solo sirve para comprobar firmas, no para crearlas.
// La llave privada (la que firma) la tiene solo MN Scents y nunca se sube a este repositorio.
export const LLAVE_PUBLICA = {
  kty: 'EC', crv: 'P-256',
  x: 'MSjW3Vfeb2O8xcL0pzXnqspw2zgCvUjSbatc3vaJObc',
  y: '9LlRrBQFC_C9w24pGJHW_N5BNq5TBRrSoXkL5SC0TaU',
};
