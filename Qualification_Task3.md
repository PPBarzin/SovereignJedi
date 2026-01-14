  # Pré-test (0:30)
  
  Dans ton repo local :
  
  git checkout task-03-wallet-connection
  pnpm install
  pnpm -C apps/web dev -- --port 1620
  
  
  Si pnpm install re-meurt, c’est ton problème d’environnement (on le traitera après), mais on ne confond pas.
  
  ## Preuve de test
  ppbarzin@Innov8Lab:~/Documents/Programmation/tools/SovereignJedi$ pnpm install
Scope: all 4 workspace projects
Lockfile is up to date, resolution step is skipped
Already up to date
packages/crypto prepare$ pnpm -w -r build
│ > sovereign-jedi@0.0.0 build /home/ppbarzin/Documents/Programmation/tools/SovereignJedi
│ > pnpm --filter "packages/*" -r build && pnpm --filter "apps/*" -r build
│ No projects matched the filters in "/home/ppbarzin/Documents/Programmation/tools/SovereignJedi"
│ No projects matched the filters in "/home/ppbarzin/Documents/Programmation/tools/SovereignJedi"
└─ Done in 1.2s
Done in 2.7s
ppbarzin@Innov8Lab:~/Documents/Programmation/tools/SovereignJedi$ pnpm -C apps/web dev -- --port 1620

> @sj/web@0.1.0 dev /home/ppbarzin/Documents/Programmation/tools/SovereignJedi/apps/web
> next dev -p 1620 "--" "--port" "1620"

  ▲ Next.js 13.5.11
  - Local:        http://localhost:1620

 ✓ Ready in 3.2s
  
    
  # OQ-02 Connect (1 min)
  
  Ouvre l’app
  
  Clique WalletMultiButton
  
  Attendu :
  
  une modal s’ouvre
  
  Phantom apparaît
  
  tu connectes → l’adresse s’affiche
  
  Fail typique : modal ne s’ouvre pas / bouton inactif → problème provider _app.tsx ou CSS import.
  
  PASS
  
  # OQ-03 Disconnect (30 sec)
  
  Disconnect via WalletMultiButton
  
  Attendu :
  
  plus d’adresse
  
  état = disconnected
  
  Point de contrôle important : refresh la page après disconnect → tu ne dois pas être “verified” par magie.
  
  PASS
  
  # OQ-04 Verify (1 min)
  
  Connect
  
  Clique “Sign to Verify”
  
  Attendu :
  
  popup signature Phantom
  
  sj_identity écrit dans localStorage
  
  IdentityStatus => Verified
  
  # OQ-07 / OQ-08 Upload gating (1 min)
  
  Sans verify : upload picker + drag/drop → bloqué
  
  Après verify : upload → OK
  
  # OQ-10 (très important) Changement de wallet / account (1 min)
  
  Tu verifies
  
  Tu changes d’account dans Phantom (ou tu disconnect/reconnect)
  
  Attendu :
  
  identity doit être invalidée (ou au moins considérée invalide)
  
  upload doit re-demander verify
  
  👉 C’est le test qui révèle les implémentations “faussement sécurisées”.
