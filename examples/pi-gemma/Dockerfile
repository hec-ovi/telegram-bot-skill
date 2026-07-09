FROM node:24-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g --ignore-scripts @earendil-works/pi-coding-agent

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /skill
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["pi", "--skill", "/skill"]
