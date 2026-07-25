FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /runner
COPY package.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund
COPY runner.mjs ./

CMD ["node", "runner.mjs"]
