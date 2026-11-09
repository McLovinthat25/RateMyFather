# How to put RateMyFather live

This guide takes the finished code and puts it on the public web at ratemyfather.com. Do the steps in order. You do not need to change any code.

You will use three services you already have or can open for free:

1. Neon, for the database.
2. GitHub, to hold the code.
3. Render, to run the website.
4. GoDaddy, where ratemyfather.com is already registered. GoDaddy stays as the registrar. You will only change DNS records there, as described in step 6.

Keep real secrets only in the Render dashboard. Never type a real secret or database connection string into render.yaml or .env.example.

## 1. Create the database in Neon

1. Create a free Neon account and sign in.
2. Create a new project and a new database inside it.
3. Find the database connection string in Neon and copy it. Keep it safe. You will paste it into Render in step 3.
4. Do not share this connection string in chat, email, or a public file.

## 2. Put the code on GitHub and create the Render service

1. Push the finished code to a GitHub repo. Make sure the repo includes server.js at the top level, package.json, the scripts folder, and the seed folder with priests.json.
2. Create a free Render account and sign in.
3. Create a new web service from that GitHub repo, or deploy from the render.yaml blueprint in the repo.
4. Confirm these settings if Render asks:
   1. Runtime: Node.
   2. Build command: npm install.
   3. Start command: npm start.
5. Do not deploy with a real database connection string or owner secret typed into a file. Those go in the Render dashboard in the next step.

## 3. Set the two secrets in Render

1. In Render, open your ratemyfather web service, then open Environment.
2. Add DATABASE_URL and paste in the Neon connection string you copied in step 1.
3. Add OWNER_SECRET. This is the password that lets only you reach moderation on the live site.
4. Pick a strong owner secret:
   1. Make it long, at least 24 characters.
   2. Use a mix of letters, numbers, and symbols.
   3. Do not reuse a password you use anywhere else.
   4. The easiest safe way is to let a password manager generate it, then save it in that password manager.
5. Save the environment settings in Render.
6. To reach moderation later, open the live site and click "Owner moderation" in the footer, which opens the sign-in page at /owner/login. Enter the OWNER_SECRET value you saved in Render. Only the owner should know this value. After signing in you land on the moderation queue at /owner, with the auto-approved audit list at /owner/audit.

## 4. Deploy, then load the priest data

1. Deploy the Render service. Wait until Render shows the deploy as live.
2. Load the priest data into the Neon database by running the seed once. In Render, open the Shell for this service, or run a one time job for this service, and run this command:
   npm run seed
3. Wait until that command finishes without an error before you move on. This step loads priests.json into the database.
4. If the seed reports an error, check that DATABASE_URL in Render is correct and that the seed file is in the repo, then run the seed once again.

## 5. Check the live site

Open the Render web address for the service and check each of these:

1. The home page loads.
2. Search finds a priest by name.
3. Opening a priest profile page shows that priest correctly.
4. The moderation sign in screen (footer "Owner moderation", page /owner/login) accepts the OWNER_SECRET value you saved in Render. After signing in, the queue at /owner should load.

If any of these fail, do not move on to the domain step yet. Fix the deploy or the seed first.

## 6. Point ratemyfather.com at Render in GoDaddy

Keep GoDaddy as the registrar. Change only DNS records, unless Render explicitly tells you a nameserver change is required.

1. In Render, open your web service, then open Custom Domains, and add ratemyfather.com. Render will show you the exact host IP and hostname to use. Copy those exact values. Do not guess them.
2. In GoDaddy, open DNS for ratemyfather.com.
3. Edit the A record for @ so it points to the Render host IP shown in Render.
4. Edit the CNAME record for www so it points to the Render hostname shown in Render.
5. Add the A record for @ or the CNAME record for www only if one of them is missing. Do not create duplicates.
6. Change nameservers only if Render explicitly requires it. If you do have to change nameservers, first copy down every existing DNS record, especially any email records, so email is not lost in the move.
7. Save the DNS changes.
8. DNS changes usually take effect in under an hour, but can take up to 48 hours. During that time some visitors may still see the old site or no site. That is normal.
9. After the change has taken effect, open ratemyfather.com and www.ratemyfather.com and repeat the checks in step 5.

## 7. What to expect on the free tier

Render free services sleep when idle. That means the first visit after a quiet stretch takes a few seconds while the service wakes up. Later visits while it is awake load normally. This is expected on the free tier and is not a broken site.

## 8. One important reminder

Update the expired GoDaddy payment method so the domain itself is not interrupted. DNS and hosting can be perfect and the site can still go down if the domain registration lapses because payment failed. Update payment in GoDaddy before the domain renewal date.
