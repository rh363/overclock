import { test, expect } from 'claude-code/testing'

// Nel test `$` è l'engine e non espone `$.plugin`: se il manifest o il modulo
// fossero invalidi, `claude plugin test` fallirebbe prima di eseguire il corpo.
test('il plugin si carica', async ($) => {
  expect(typeof $.session).toBe('object')
})
