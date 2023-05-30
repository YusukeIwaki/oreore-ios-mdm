FROM ruby:3.0-alpine3.16

# Install dependencies
RUN apk add --update --no-cache \
    build-base \
    postgresql-dev \
    tzdata

RUN mkdir /app
WORKDIR /app

COPY --chmod=0755 docker_entrypoint.sh /
ENTRYPOINT [ "/docker_entrypoint.sh" ]
