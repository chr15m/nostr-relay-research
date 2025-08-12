The purpose of this repo is:

1. To gather stats on existing deployed relays.
2. To research a [DHT implementation for Nostr relays](./XX.md).

[Try the relay DHT simulation](https://chr15m.github.io/nostr-relay-research/) (check the console too).

### Relay stats

Relay list scraped from 

The largest relay responding to a `COUNT` of NIP-65 events (nostr.band) reports 2.25 million events.

```
$ ./relay-stats.sh

Total relays probed: 379
Number of relays that failed to provide a valid NIP-11 response: 78 (20.58%)

Summary of relay software:
    129 strfry               git+https://github.com/hoytech/strfry.git
     84 nostr-rs-relay       https://git.sr.ht/~gheartsfield/nostr-rs-relay
     33 nostream             git+https://github.com/cameri/nostream.git
     27 haven                https://github.com/bitvora/haven
     10 wot-relay            https://github.com/bitvora/wot-relay
     10 khatru               https://github.com/fiatjaf/khatru
      8 chorus               chorus
      4 khatru-pyramid       https://github.com/github-tijlxyz/khatru-pyramid
      3 sw2                  https://github.com/bitvora/sw2
      3 bostr                git+https://git.sr.ht/~yonle/bostr
      2 relay.nostr.band     https://relay.nostr.band
      1 well-goknown         https://git.devvul.com/asara/well-goknown
      1 Transpher            Transpher
      1 rnostr               https://github.com/rnostr/rnostr
      1 pyramid              https://github.com/fiatjaf/pyramid
      1 nostr_relay          https://code.pobblelabs.org/fossil/nostr_relay
      1 nost-py              git+https://github.com/UTXOnly/nost-py.git
      1 netstr               https://github.com/bezysoftware/netstr/
      1 monstr               https://github.com/monty888/monstr
      1 lumina-relay         lumina-relay
      1 ligess               https://github.com/mutatrum/ligess
      1 immortal             https://github.com/dezh-tech/immortal
      1 frith                https://github.com/coracle-social/frith
      1 ddsr                 https://github.com/dezh-tech/ddsr
      1 custom               custom
      1 coordinator          https://pkg.go.dev/fiatjaf.com/promenade/coordinator
      1 chronicle            https://github.com/dtonon/chronicle
      1 bucket               https://github.com/coracle-social/bucket
      1 bostr2               git+https://codeberg.org/Yonle/bostr2

Summary of relay errors:
     46 Weird 'context' message
     17 Malformed NIP-11 JSON
     10 Timeout
     10 Server misbehaving
     10 Invalid NIP-11 JSON
      9 Other
      9 No route to host
      4 HTML/HTTP Error
      1 TLS/SSL Error
      1 Network unreachable

Summary of declared NIP support:
    327 NIP-01
    324 NIP-11
    322 NIP-09
    283 NIP-40
    255 NIP-02
    250 NIP-22
    194 NIP-20
    189 NIP-12
    187 NIP-16
    186 NIP-33
    174 NIP-04
    163 NIP-28
    129 NIP-15
    127 NIP-70
     97 NIP-42
     66 NIP-77
     57 NIP-86
     45 NIP-45
     17 NIP-26
     10 NIP-65
     10 NIP-59
      9 NIP-50
      6 NIP-29
      5 NIP-05
      5 NIP-17
      4 NIP-62
      4 NIP-57
      4 NIP-25
      3 NIP-99
      3 NIP-94
      3 NIP-72
      3 NIP-51
      3 NIP-38
      3 NIP-03
      3 NIP-13
      2 NIP-92
      2 NIP-84
      2 NIP-71
      2 NIP-64
      2 NIP-61
      2 NIP-58
      2 NIP-56
      2 NIP-54
      2 NIP-47
      2 NIP-46
      2 NIP-44
      2 NIP-36
      2 NIP-30
      2 NIP-23
      2 NIP-18
      2 NIP-111
      1 NIP-96
      1 NIP-90
      1 NIP-89
      1 NIP-78
      1 NIP-75
      1 NIP-73
      1 NIP-69
      1 NIP-60
      1 NIP-53
      1 NIP-52
      1 NIP-49
      1 NIP-48
      1 NIP-39
      1 NIP-34
      1 NIP-32
      1 NIP-31
      1 NIP-27
      1 NIP-24
      1 NIP-21
      1 NIP-19
      1 NIP-14
      1 NIP-119
      1 NIP-104
      1 NIP-10
      1 NIP-00

Summary of NIP-65 Event Counts:
  - Relays with successful counts: 32
  - Relays with unknown counts (errors): 347

Distribution of NIP-65 counts:
   2269006 relay.nostr.band
   2269006 feeds.nostr.band
    210084 relay.lumina.rocks
     79145 chorus.tealeaf.dev
      2442 relay.nostrfreedom.net
        25 greensoul.space
         2 relay.devvul.com
         2 nostr.polyserv.xyz
         1 tamby.mjex.me
         1 relay.nostrr.de
         1 relay.diablocanyon1.com
         1 relay.danieldaquino.me
         1 relay.caramboo.com
         1 relay.brightbolt.net
         1 pnostr.self-determined.de
         1 nostr.sudocarlos.com
         1 nostr.pailakapo.com
         1 nostr.jonmartins.com
         1 nostr.dl3.dedyn.io
         1 nostr.d11n.net
         1 hbr.coracle.social
         1 haven.tealeaf.dev
         1 haven.relayted.de
         1 haven.on4r.net
         0 skeme.vanderwarker.family
         0 relay.yana.do
         0 relay.nosto.re
         0 relay.basspistol.org
         0 promenade.fiatjaf.com
         0 nostr.rikmeijer.nl
         0 nostr.jcloud.es
         0 h.codingarena.top
```
