FROM node:22-bookworm-slim

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .

EXPOSE 5178
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
