import type { ModelReleaseDocument } from "../../types/modelReleaseRevisions";

/**
 * Sanitized schema-41 active contract documents for the ten R0-pinned
 * published models. This fixture contains no credential revision, secret,
 * task, Provider response, prompt, user, media or protected JSON data.
 */
export const incGen018ActiveModelContractFixtures = {
  "3919d490-8739-490a-8bce-0678c27e4760": {
    "capability": "video",
    "capabilitySchema": {
      "fields": [
        {
          "defaultValue": "text",
          "group": "input",
          "key": "inputMode",
          "label": "生成方式",
          "options": [
            {
              "label": "文本",
              "value": "text"
            },
            {
              "label": "图片参考",
              "value": "image"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "16:9",
          "group": "main",
          "key": "aspectRatio",
          "label": "比例",
          "options": [
            {
              "label": "1:1",
              "value": "1:1"
            },
            {
              "label": "16:9",
              "value": "16:9"
            },
            {
              "label": "9:16",
              "value": "9:16"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 5,
          "group": "main",
          "key": "duration",
          "label": "时长",
          "options": [
            {
              "label": "5s",
              "value": 5
            },
            {
              "label": "10s",
              "value": 10
            },
            {
              "label": "15s",
              "value": 15
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "standard",
          "group": "main",
          "key": "videoMode",
          "label": "生成品质",
          "options": [
            {
              "label": "标准",
              "value": "standard"
            },
            {
              "label": "高品质",
              "value": "quality"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 1,
          "group": "output",
          "key": "outputCount",
          "label": "数量",
          "options": [
            {
              "label": "1×",
              "value": 1
            }
          ],
          "summary": true,
          "type": "select"
        }
      ],
      "groups": [
        {
          "key": "input",
          "label": "输入",
          "order": 10
        },
        {
          "key": "main",
          "label": "参数",
          "order": 20
        },
        {
          "key": "advanced",
          "label": "高级设置",
          "order": 30
        },
        {
          "key": "output",
          "label": "输出",
          "order": 40
        }
      ],
      "inputPolicy": {
        "promptPolicy": "own-required",
        "required": {},
        "rolePolicies": [
          {
            "enabledWhen": [
              {
                "key": "inputMode",
                "operator": "equals",
                "value": "image"
              }
            ],
            "roles": {
              "audio": [],
              "image": [
                "reference-image"
              ],
              "text": [
                "instruction"
              ],
              "video": []
            }
          }
        ],
        "roles": {
          "audio": [],
          "image": [
            "reference-image"
          ],
          "text": [
            "instruction"
          ],
          "video": []
        },
        "switchPolicy": "keep-edge"
      },
      "referenceInputs": {
        "audio": 0,
        "image": 7,
        "video": 0
      },
      "referenceMediaRules": {
        "image": {
          "contentTypes": [
            "image/png"
          ],
          "maxBytes": 31457280
        }
      },
      "referencePolicy": {
        "modeKey": "inputMode",
        "modes": {
          "image": {
            "sets": [
              {
                "audio": 0,
                "image": 7,
                "video": 0
              }
            ]
          },
          "text": {
            "sets": [
              {
                "audio": 0,
                "image": 0,
                "video": 0
              }
            ]
          }
        }
      },
      "version": 2
    },
    "connectorFamily": "specialized-code",
    "connectorVersion": 1,
    "documentation": [],
    "evidence": "SPECIALIZED",
    "executionContract": {
      "connectorFamily": "specialized-code",
      "connectorVersion": 1,
      "create": {
        "method": "POST",
        "path": "/v1/media/generate"
      },
      "modes": [
        {
          "bindings": [
            {
              "source": {
                "kind": "model-id"
              },
              "target": {
                "location": "json",
                "path": "model"
              }
            },
            {
              "source": {
                "kind": "prompt"
              },
              "target": {
                "location": "json",
                "path": "prompt"
              }
            }
          ],
          "id": "specialized-code",
          "prompt": "required",
          "roles": []
        }
      ],
      "result": {
        "resultPath": "result_url"
      },
      "version": 1
    },
    "modelId": "3919d490-8739-490a-8bce-0678c27e4760",
    "providerModelId": "kling-v3-omni-cankao",
    "providerProfileId": "06831aee-5794-44cd-8e43-cc613eb60fdf",
    "providerProtocol": "media-generate",
    "runtime": "specialized-code"
  },
  "4d6196b4-00de-46ca-8011-383ad810a865": {
    "capability": "audio",
    "capabilitySchema": {
      "fields": [
        {
          "defaultValue": "instrumental",
          "group": "main",
          "key": "musicGenerationMode",
          "label": "生成方式",
          "options": [
            {
              "label": "纯音乐",
              "value": "instrumental"
            },
            {
              "label": "提示词歌曲",
              "value": "prompt-song"
            },
            {
              "label": "自定义歌词歌曲",
              "value": "lyrics-song"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "",
          "group": "input",
          "key": "lyrics",
          "label": "歌词",
          "maxLength": 8000,
          "options": [],
          "placeholder": "输入歌词",
          "requiredWhen": [
            {
              "key": "musicGenerationMode",
              "operator": "equals",
              "value": "lyrics-song"
            }
          ],
          "type": "textarea",
          "visibleWhen": [
            {
              "key": "musicGenerationMode",
              "operator": "equals",
              "value": "lyrics-song"
            }
          ]
        },
        {
          "defaultValue": "female",
          "group": "main",
          "key": "vocalGender",
          "label": "人声",
          "options": [
            {
              "label": "女声",
              "value": "female"
            },
            {
              "label": "男声",
              "value": "male"
            }
          ],
          "summary": true,
          "type": "select",
          "visibleWhen": [
            {
              "key": "musicGenerationMode",
              "operator": "equals",
              "value": "lyrics-song"
            }
          ]
        },
        {
          "defaultValue": false,
          "group": "advanced",
          "key": "streamPlayback",
          "label": "边生成边试听",
          "options": [
            {
              "label": "开启",
              "value": true
            },
            {
              "label": "关闭",
              "value": false
            }
          ],
          "type": "boolean"
        },
        {
          "defaultValue": 1,
          "group": "output",
          "key": "outputCount",
          "label": "数量",
          "options": [
            {
              "label": "1×",
              "value": 1
            }
          ],
          "summary": true,
          "type": "select"
        }
      ],
      "groups": [
        {
          "key": "input",
          "label": "输入",
          "order": 10
        },
        {
          "key": "main",
          "label": "参数",
          "order": 20
        },
        {
          "key": "advanced",
          "label": "高级设置",
          "order": 30
        },
        {
          "key": "output",
          "label": "输出",
          "order": 40
        }
      ],
      "inputPolicy": {
        "promptPolicy": "own-required",
        "required": {},
        "roles": {
          "audio": [],
          "image": [],
          "text": [],
          "video": []
        },
        "switchPolicy": "keep-edge"
      },
      "referenceInputs": {
        "audio": 0,
        "image": 0,
        "video": 0
      },
      "version": 2
    },
    "connectorFamily": "mureka-native",
    "connectorVersion": 1,
    "documentation": [
      {
        "checkedAt": "2026-08-27",
        "url": "https://platform.mureka.ai/docs/en/changelog.html"
      }
    ],
    "evidence": "SPECIALIZED",
    "executionContract": {
      "connectorFamily": "mureka-native",
      "connectorVersion": 1,
      "create": {
        "method": "POST",
        "path": "/v1/song/generate"
      },
      "modes": [
        {
          "bindings": [
            {
              "source": {
                "kind": "model-id"
              },
              "target": {
                "location": "json",
                "path": "model"
              }
            },
            {
              "source": {
                "kind": "prompt"
              },
              "target": {
                "location": "json",
                "path": "prompt"
              }
            }
          ],
          "id": "specialized-code",
          "prompt": "required",
          "roles": []
        }
      ],
      "result": {
        "resultPath": "result_url"
      },
      "version": 2
    },
    "modelId": "4d6196b4-00de-46ca-8011-383ad810a865",
    "providerModelId": "mureka-9",
    "providerProfileId": "b8ee8c7a-6526-4a40-9d76-1d998f7d3eb0",
    "providerProtocol": "native",
    "runtime": "specialized-code"
  },
  "624827c6-5541-4cc8-93ac-4f9d5ce79602": {
    "capability": "video",
    "capabilitySchema": {
      "fields": [
        {
          "defaultValue": "text",
          "group": "input",
          "key": "inputMode",
          "label": "生成方式",
          "options": [
            {
              "label": "文本",
              "value": "text"
            },
            {
              "label": "图片参考",
              "value": "image"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "16:9",
          "group": "main",
          "key": "aspectRatio",
          "label": "比例",
          "options": [
            {
              "label": "1:1",
              "value": "1:1"
            },
            {
              "label": "16:9",
              "value": "16:9"
            },
            {
              "label": "9:16",
              "value": "9:16"
            },
            {
              "label": "3:2",
              "value": "3:2"
            },
            {
              "label": "2:3",
              "value": "2:3"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "720p",
          "group": "main",
          "key": "resolution",
          "label": "清晰度",
          "options": [
            {
              "label": "720p",
              "value": "720p"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 6,
          "group": "main",
          "key": "duration",
          "label": "时长",
          "options": [
            {
              "label": "6s",
              "value": 6
            },
            {
              "label": "10s",
              "value": 10
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": true,
          "group": "main",
          "key": "generateAudio",
          "label": "生成音频",
          "options": [
            {
              "label": "开启",
              "value": true
            },
            {
              "label": "关闭",
              "value": false
            }
          ],
          "summary": true,
          "type": "boolean"
        },
        {
          "defaultValue": 1,
          "group": "output",
          "key": "outputCount",
          "label": "数量",
          "options": [
            {
              "label": "1×",
              "value": 1
            }
          ],
          "summary": true,
          "type": "select"
        }
      ],
      "groups": [
        {
          "key": "input",
          "label": "输入",
          "order": 10
        },
        {
          "key": "main",
          "label": "参数",
          "order": 20
        },
        {
          "key": "advanced",
          "label": "高级设置",
          "order": 30
        },
        {
          "key": "output",
          "label": "输出",
          "order": 40
        }
      ],
      "inputPolicy": {
        "promptPolicy": "own-required",
        "required": {},
        "rolePolicies": [
          {
            "assignment": {
              "image": [
                "first-frame"
              ]
            },
            "enabledWhen": [
              {
                "key": "inputMode",
                "operator": "equals",
                "value": "image"
              }
            ],
            "limits": [
              {
                "kind": "image",
                "maxCount": 1,
                "minCount": 1,
                "role": "first-frame"
              }
            ],
            "roles": {
              "audio": [],
              "image": [
                "first-frame"
              ],
              "text": [
                "instruction"
              ],
              "video": []
            }
          }
        ],
        "roles": {
          "audio": [],
          "image": [
            "first-frame"
          ],
          "text": [
            "instruction"
          ],
          "video": []
        },
        "switchPolicy": "keep-edge"
      },
      "referenceInputs": {
        "audio": 0,
        "image": 1,
        "video": 0
      },
      "referencePolicy": {
        "modeKey": "inputMode",
        "modes": {
          "image": {
            "sets": [
              {
                "audio": 0,
                "image": 1,
                "video": 0
              }
            ]
          },
          "text": {
            "sets": [
              {
                "audio": 0,
                "image": 0,
                "video": 0
              }
            ]
          }
        }
      },
      "version": 2
    },
    "connectorFamily": "generic-async-media",
    "connectorVersion": 1,
    "documentation": [],
    "evidence": "EXACT",
    "executionContract": {
      "connectorFamily": "generic-async-media",
      "connectorVersion": 1,
      "create": {
        "method": "POST",
        "path": "/v1/media/generate",
        "taskIdPath": "task_id"
      },
      "modes": [
        {
          "bindings": [
            {
              "source": {
                "kind": "model-id"
              },
              "target": {
                "location": "json",
                "path": "model"
              }
            },
            {
              "source": {
                "kind": "prompt"
              },
              "target": {
                "location": "json",
                "path": "prompt"
              }
            },
            {
              "source": {
                "key": "aspectRatio",
                "kind": "parameter"
              },
              "target": {
                "location": "json",
                "path": "params.aspect_ratio"
              }
            },
            {
              "source": {
                "key": "resolution",
                "kind": "parameter"
              },
              "target": {
                "location": "json",
                "path": "params.resolution"
              }
            },
            {
              "source": {
                "key": "duration",
                "kind": "parameter"
              },
              "target": {
                "location": "json",
                "path": "params.duration"
              }
            },
            {
              "source": {
                "key": "generateAudio",
                "kind": "parameter"
              },
              "target": {
                "location": "json",
                "path": "params.generate_audio"
              }
            }
          ],
          "evidence": "EXACT",
          "id": "text-to-video",
          "prompt": "required",
          "roles": [],
          "runtime": "declarative"
        },
        {
          "bindings": [
            {
              "source": {
                "kind": "model-id"
              },
              "target": {
                "location": "json",
                "path": "model"
              }
            },
            {
              "source": {
                "kind": "prompt"
              },
              "target": {
                "location": "json",
                "path": "prompt"
              }
            },
            {
              "source": {
                "key": "aspectRatio",
                "kind": "parameter"
              },
              "target": {
                "location": "json",
                "path": "params.aspect_ratio"
              }
            },
            {
              "source": {
                "key": "resolution",
                "kind": "parameter"
              },
              "target": {
                "location": "json",
                "path": "params.resolution"
              }
            },
            {
              "source": {
                "key": "duration",
                "kind": "parameter"
              },
              "target": {
                "location": "json",
                "path": "params.duration"
              }
            },
            {
              "source": {
                "key": "generateAudio",
                "kind": "parameter"
              },
              "target": {
                "location": "json",
                "path": "params.generate_audio"
              }
            },
            {
              "source": {
                "kind": "role",
                "roleId": "first-frame"
              },
              "target": {
                "location": "json",
                "path": "params.images"
              },
              "transform": "array"
            }
          ],
          "evidence": "EXACT",
          "id": "first-frame-to-video",
          "prompt": "required",
          "roles": [
            {
              "id": "first-frame",
              "kind": "image",
              "maxItems": 1,
              "minItems": 1,
              "ordered": true,
              "shape": "url"
            }
          ],
          "runtime": "declarative"
        }
      ],
      "poll": {
        "method": "GET",
        "path": "/v1/media/status",
        "taskIdTarget": {
          "location": "query",
          "path": "task_id"
        }
      },
      "result": {
        "resultPath": "result_url",
        "states": {
          "failed": [
            "failed"
          ],
          "running": [
            "pending",
            "running"
          ],
          "succeeded": [
            "success"
          ]
        }
      },
      "version": 2
    },
    "modelId": "624827c6-5541-4cc8-93ac-4f9d5ce79602",
    "providerModelId": "grok-video-3",
    "providerProfileId": "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    "providerProtocol": "media-generate",
    "runtime": "declarative"
  },
  "65600fd0-739d-4359-9c9c-958e3ae49b05": {
    "capability": "audio",
    "capabilitySchema": {
      "fields": [
        {
          "defaultValue": "text",
          "group": "input",
          "key": "inputMode",
          "label": "生成方式",
          "options": [
            {
              "label": "文本",
              "value": "text"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "zh_female_vv_uranus_bigtts",
          "group": "main",
          "key": "speaker",
          "label": "音色",
          "options": [
            {
              "label": "Vivi 2.0",
              "value": "zh_female_vv_uranus_bigtts"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "0",
          "group": "main",
          "key": "speechRate",
          "label": "语速",
          "options": [
            {
              "label": "-50",
              "value": "-50"
            },
            {
              "label": "-25",
              "value": "-25"
            },
            {
              "label": "0",
              "value": "0"
            },
            {
              "label": "25",
              "value": "25"
            },
            {
              "label": "50",
              "value": "50"
            },
            {
              "label": "100",
              "value": "100"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "auto",
          "group": "main",
          "key": "emotion",
          "label": "情绪",
          "options": [
            {
              "label": "自动",
              "value": "auto"
            },
            {
              "label": "愉快",
              "value": "happy"
            },
            {
              "label": "伤感",
              "value": "sad"
            },
            {
              "label": "愤怒",
              "value": "angry"
            },
            {
              "label": "恐惧",
              "value": "fearful"
            },
            {
              "label": "惊讶",
              "value": "surprised"
            },
            {
              "label": "平静",
              "value": "calm"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 4,
          "enabledWhen": [
            {
              "key": "emotion",
              "operator": "notEquals",
              "value": "auto"
            }
          ],
          "group": "advanced",
          "key": "emotionScale",
          "label": "情绪强度",
          "options": [
            {
              "label": "1",
              "value": 1
            },
            {
              "label": "2",
              "value": 2
            },
            {
              "label": "3",
              "value": 3
            },
            {
              "label": "4",
              "value": 4
            },
            {
              "label": "5",
              "value": 5
            }
          ],
          "type": "select",
          "visibleWhen": [
            {
              "key": "emotion",
              "operator": "notEquals",
              "value": "auto"
            }
          ]
        },
        {
          "defaultValue": "mp3",
          "group": "output",
          "key": "format",
          "label": "格式",
          "options": [
            {
              "label": "MP3",
              "value": "mp3"
            },
            {
              "label": "WAV",
              "value": "wav"
            },
            {
              "label": "OGG Opus",
              "value": "ogg_opus"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 1,
          "group": "output",
          "key": "outputCount",
          "label": "数量",
          "options": [
            {
              "label": "1×",
              "value": 1
            }
          ],
          "summary": true,
          "type": "select"
        }
      ],
      "groups": [
        {
          "key": "input",
          "label": "输入",
          "order": 10
        },
        {
          "key": "main",
          "label": "参数",
          "order": 20
        },
        {
          "key": "advanced",
          "label": "高级设置",
          "order": 30
        },
        {
          "key": "output",
          "label": "输出",
          "order": 40
        }
      ],
      "referenceInputs": {
        "audio": 0,
        "image": 0,
        "video": 0
      },
      "version": 2
    },
    "connectorFamily": "specialized-code",
    "connectorVersion": 1,
    "documentation": [],
    "evidence": "SPECIALIZED",
    "executionContract": {
      "connectorFamily": "specialized-code",
      "connectorVersion": 1,
      "create": {
        "method": "POST",
        "path": "/v1/media/generate"
      },
      "modes": [
        {
          "bindings": [
            {
              "source": {
                "kind": "model-id"
              },
              "target": {
                "location": "json",
                "path": "model"
              }
            },
            {
              "source": {
                "kind": "prompt"
              },
              "target": {
                "location": "json",
                "path": "prompt"
              }
            }
          ],
          "id": "specialized-code",
          "prompt": "required",
          "roles": []
        }
      ],
      "result": {
        "resultPath": "result_url"
      },
      "version": 1
    },
    "modelId": "65600fd0-739d-4359-9c9c-958e3ae49b05",
    "providerModelId": "doubao-tts-2.0",
    "providerProfileId": "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    "providerProtocol": "media-generate",
    "runtime": "specialized-code"
  },
  "65830fc7-3888-48ea-a842-87db6df65ec1": {
    "capability": "audio",
    "capabilitySchema": {
      "fields": [
        {
          "defaultValue": "text",
          "group": "input",
          "key": "inputMode",
          "label": "生成方式",
          "options": [
            {
              "label": "文本",
              "value": "text"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "instrumental",
          "group": "main",
          "key": "musicGenerationMode",
          "label": "生成方式",
          "options": [
            {
              "label": "纯音乐",
              "value": "instrumental"
            },
            {
              "label": "提示词歌曲",
              "value": "prompt-song"
            },
            {
              "label": "自定义歌词歌曲",
              "value": "lyrics-song"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "",
          "group": "input",
          "key": "lyrics",
          "label": "歌词",
          "maxLength": 8000,
          "options": [],
          "placeholder": "输入歌词",
          "requiredWhen": [
            {
              "key": "musicGenerationMode",
              "operator": "equals",
              "value": "lyrics-song"
            }
          ],
          "type": "textarea",
          "visibleWhen": [
            {
              "key": "musicGenerationMode",
              "operator": "equals",
              "value": "lyrics-song"
            }
          ]
        },
        {
          "defaultValue": "auto",
          "group": "main",
          "key": "vocalGender",
          "label": "人声",
          "options": [
            {
              "label": "自动",
              "value": "auto"
            },
            {
              "label": "女声",
              "value": "female"
            },
            {
              "label": "男声",
              "value": "male"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 44100,
          "group": "output",
          "key": "sampleRate",
          "label": "采样率",
          "options": [
            {
              "label": "44100",
              "value": 44100
            },
            {
              "label": "48000",
              "value": 48000
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 192000,
          "group": "output",
          "key": "bitrate",
          "label": "码率",
          "options": [
            {
              "label": "128000",
              "value": 128000
            },
            {
              "label": "192000",
              "value": 192000
            },
            {
              "label": "256000",
              "value": 256000
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 1,
          "group": "output",
          "key": "outputCount",
          "label": "数量",
          "options": [
            {
              "label": "1×",
              "value": 1
            }
          ],
          "summary": true,
          "type": "select"
        }
      ],
      "groups": [
        {
          "key": "input",
          "label": "输入",
          "order": 10
        },
        {
          "key": "main",
          "label": "参数",
          "order": 20
        },
        {
          "key": "advanced",
          "label": "高级设置",
          "order": 30
        },
        {
          "key": "output",
          "label": "输出",
          "order": 40
        }
      ],
      "inputPolicy": {
        "promptPolicy": "own-required",
        "required": {},
        "roles": {
          "audio": [],
          "image": [],
          "text": [
            "instruction"
          ],
          "video": []
        },
        "switchPolicy": "keep-edge"
      },
      "referenceInputs": {
        "audio": 0,
        "image": 0,
        "video": 0
      },
      "version": 2
    },
    "connectorFamily": "specialized-code",
    "connectorVersion": 1,
    "documentation": [],
    "evidence": "SPECIALIZED",
    "executionContract": {
      "connectorFamily": "specialized-code",
      "connectorVersion": 1,
      "create": {
        "method": "POST",
        "path": "/v1/media/generate"
      },
      "modes": [
        {
          "bindings": [
            {
              "source": {
                "kind": "model-id"
              },
              "target": {
                "location": "json",
                "path": "model"
              }
            },
            {
              "source": {
                "kind": "prompt"
              },
              "target": {
                "location": "json",
                "path": "prompt"
              }
            }
          ],
          "id": "specialized-code",
          "prompt": "required",
          "roles": []
        }
      ],
      "result": {
        "resultPath": "result_url"
      },
      "version": 1
    },
    "modelId": "65830fc7-3888-48ea-a842-87db6df65ec1",
    "providerModelId": "suno-v4.5",
    "providerProfileId": "06831aee-5794-44cd-8e43-cc613eb60fdf",
    "providerProtocol": "media-generate",
    "runtime": "specialized-code"
  },
  "897d3dfc-83e4-48e9-a033-ca612338681b": {
    "capability": "video",
    "capabilitySchema": {
      "fields": [
        {
          "defaultValue": "text",
          "group": "input",
          "key": "inputMode",
          "label": "生成方式",
          "options": [
            {
              "label": "文本",
              "value": "text"
            },
            {
              "label": "首尾帧",
              "value": "first-last-frame"
            },
            {
              "label": "全能参考",
              "value": "multimodal"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "16:9",
          "group": "main",
          "key": "aspectRatio",
          "label": "比例",
          "options": [
            {
              "label": "1:1",
              "value": "1:1"
            },
            {
              "label": "16:9",
              "value": "16:9"
            },
            {
              "label": "9:16",
              "value": "9:16"
            },
            {
              "label": "4:3",
              "value": "4:3"
            },
            {
              "label": "3:4",
              "value": "3:4"
            },
            {
              "label": "21:9",
              "value": "21:9"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "480p",
          "group": "main",
          "key": "resolution",
          "label": "清晰度",
          "options": [
            {
              "label": "480p",
              "value": "480p"
            },
            {
              "label": "720p",
              "value": "720p"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 5,
          "group": "main",
          "key": "duration",
          "label": "时长",
          "options": [
            {
              "label": "4s",
              "value": 4
            },
            {
              "label": "5s",
              "value": 5
            },
            {
              "label": "6s",
              "value": 6
            },
            {
              "label": "7s",
              "value": 7
            },
            {
              "label": "8s",
              "value": 8
            },
            {
              "label": "9s",
              "value": 9
            },
            {
              "label": "10s",
              "value": 10
            },
            {
              "label": "11s",
              "value": 11
            },
            {
              "label": "12s",
              "value": 12
            },
            {
              "label": "13s",
              "value": 13
            },
            {
              "label": "14s",
              "value": 14
            },
            {
              "label": "15s",
              "value": 15
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": true,
          "group": "main",
          "key": "generateAudio",
          "label": "生成音频",
          "options": [
            {
              "label": "开启",
              "value": true
            },
            {
              "label": "关闭",
              "value": false
            }
          ],
          "summary": true,
          "type": "boolean"
        },
        {
          "defaultValue": 1,
          "group": "output",
          "key": "outputCount",
          "label": "数量",
          "options": [
            {
              "label": "1×",
              "value": 1
            }
          ],
          "summary": true,
          "type": "select"
        }
      ],
      "groups": [
        {
          "key": "input",
          "label": "输入",
          "order": 10
        },
        {
          "key": "main",
          "label": "参数",
          "order": 20
        },
        {
          "key": "advanced",
          "label": "高级设置",
          "order": 30
        },
        {
          "key": "output",
          "label": "输出",
          "order": 40
        }
      ],
      "inputPolicy": {
        "promptPolicy": "own-required",
        "required": {},
        "rolePolicies": [
          {
            "enabledWhen": [
              {
                "key": "inputMode",
                "operator": "equals",
                "value": "text"
              }
            ],
            "roles": {
              "audio": [],
              "image": [],
              "text": [
                "instruction"
              ],
              "video": []
            }
          },
          {
            "assignment": {
              "image": [
                "first-frame",
                "last-frame"
              ]
            },
            "enabledWhen": [
              {
                "key": "inputMode",
                "operator": "equals",
                "value": "first-last-frame"
              }
            ],
            "limits": [
              {
                "kind": "image",
                "maxCount": 1,
                "minCount": 1,
                "role": "first-frame"
              },
              {
                "kind": "image",
                "maxCount": 1,
                "minCount": 1,
                "role": "last-frame"
              }
            ],
            "roles": {
              "audio": [],
              "image": [
                "first-frame",
                "last-frame"
              ],
              "text": [
                "instruction"
              ],
              "video": []
            }
          },
          {
            "enabledWhen": [
              {
                "key": "inputMode",
                "operator": "equals",
                "value": "multimodal"
              }
            ],
            "limits": [
              {
                "kind": "image",
                "maxCount": 1,
                "minCount": 0,
                "role": "subject"
              },
              {
                "kind": "video",
                "maxCount": 1,
                "minCount": 0,
                "role": "subject"
              }
            ],
            "roles": {
              "audio": [
                "reference-audio"
              ],
              "image": [
                "subject",
                "reference-image"
              ],
              "text": [
                "instruction"
              ],
              "video": [
                "subject",
                "reference-video"
              ]
            }
          }
        ],
        "roles": {
          "audio": [
            "reference-audio"
          ],
          "image": [
            "first-frame",
            "last-frame",
            "subject",
            "reference-image"
          ],
          "text": [
            "instruction"
          ],
          "video": [
            "subject",
            "reference-video"
          ]
        },
        "switchPolicy": "keep-edge"
      },
      "referenceInputs": {
        "audio": 3,
        "image": 9,
        "video": 3
      },
      "referenceMediaRules": {
        "audio": {
          "contentTypes": [
            "audio/mpeg",
            "audio/wav"
          ],
          "maxBytes": 15728640,
          "minDurationSeconds": 2,
          "maxDurationSeconds": 15,
          "maxTotalDurationSeconds": 15
        },
        "audioRequiresVisual": true,
        "image": {
          "contentTypes": [
            "image/png"
          ],
          "maxBytes": 31457280,
          "minWidth": 300,
          "maxWidth": 6000,
          "minHeight": 300,
          "maxHeight": 6000,
          "minAspectRatio": 0.4,
          "maxAspectRatio": 2.5
        },
        "video": {
          "contentTypes": [
            "video/mp4"
          ],
          "maxBytes": 209715200,
          "minPixelCount": 409600,
          "maxPixelCount": 8295044,
          "minDurationSeconds": 2,
          "maxDurationSeconds": 15,
          "maxTotalDurationSeconds": 15
        }
      },
      "referencePolicy": {
        "modeKey": "inputMode",
        "modes": {
          "first-last-frame": {
            "sets": [
              {
                "audio": 0,
                "image": 2,
                "video": 0
              }
            ]
          },
          "multimodal": {
            "sets": [
              {
                "audio": 3,
                "image": 9,
                "video": 3
              }
            ]
          },
          "text": {
            "sets": [
              {
                "audio": 0,
                "image": 0,
                "video": 0
              }
            ]
          }
        },
        "normalizationPriority": [
          "multimodal",
          "first-last-frame",
          "text"
        ]
      },
      "upstreamInputs": {
        "audio": {
          "limitMode": "fixed",
          "maxCount": 3,
          "supported": true
        },
        "image": {
          "limitMode": "fixed",
          "maxCount": 9,
          "supported": true
        },
        "text": {
          "limitMode": "context",
          "supported": true
        },
        "video": {
          "limitMode": "fixed",
          "maxCount": 3,
          "supported": true
        }
      },
      "version": 2
    },
    "connectorFamily": "ark-native",
    "connectorVersion": 1,
    "documentation": [
      {
        "checkedAt": "2026-08-27",
        "url": "https://www.volcengine.com/docs/82379/2222480"
      }
    ],
    "evidence": "SPECIALIZED",
    "executionContract": {
      "connectorFamily": "ark-native",
      "connectorVersion": 1,
      "create": {
        "method": "POST",
        "path": "/api/v3/chat/completions"
      },
      "modes": [
        {
          "bindings": [
            {
              "source": {
                "kind": "model-id"
              },
              "target": {
                "location": "json",
                "path": "model"
              }
            },
            {
              "source": {
                "kind": "prompt"
              },
              "target": {
                "location": "json",
                "path": "prompt"
              }
            }
          ],
          "id": "specialized-code",
          "prompt": "required",
          "roles": []
        }
      ],
      "result": {
        "resultPath": "output.0.content.0.text"
      },
      "version": 2
    },
    "modelId": "897d3dfc-83e4-48e9-a033-ca612338681b",
    "providerModelId": "doubao-seedance-2-0-mini-260615",
    "providerProfileId": "f8ed7ddc-7c09-413d-8c8f-b594c39bfe7c",
    "providerProtocol": "native",
    "runtime": "specialized-code"
  },
  "cb2e1041-33f5-49ff-bc99-994a97622db4": {
    "capability": "image",
    "capabilitySchema": {
      "fields": [
        {
          "defaultValue": "text",
          "group": "input",
          "key": "inputMode",
          "label": "生成方式",
          "options": [
            {
              "label": "文本",
              "value": "text"
            },
            {
              "label": "图片参考",
              "value": "image"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "1:1",
          "group": "main",
          "key": "aspectRatio",
          "label": "比例",
          "options": [
            {
              "label": "1:1",
              "value": "1:1"
            },
            {
              "label": "16:9",
              "value": "16:9"
            },
            {
              "label": "9:16",
              "value": "9:16"
            },
            {
              "label": "4:3",
              "value": "4:3"
            },
            {
              "label": "3:4",
              "value": "3:4"
            },
            {
              "label": "3:2",
              "value": "3:2"
            },
            {
              "label": "2:3",
              "value": "2:3"
            },
            {
              "label": "5:4",
              "value": "5:4"
            },
            {
              "label": "4:5",
              "value": "4:5"
            },
            {
              "label": "21:9",
              "value": "21:9"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "1k",
          "group": "main",
          "key": "quality",
          "label": "画质",
          "options": [
            {
              "label": "1K",
              "value": "1k"
            },
            {
              "label": "2K",
              "value": "2k"
            },
            {
              "label": "4K",
              "value": "4k"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 1,
          "group": "output",
          "key": "outputCount",
          "label": "数量",
          "options": [
            {
              "label": "1×",
              "value": 1
            }
          ],
          "summary": true,
          "type": "select"
        }
      ],
      "groups": [
        {
          "key": "input",
          "label": "输入",
          "order": 10
        },
        {
          "key": "main",
          "label": "参数",
          "order": 20
        },
        {
          "key": "advanced",
          "label": "高级设置",
          "order": 30
        },
        {
          "key": "output",
          "label": "输出",
          "order": 40
        }
      ],
      "inputPolicy": {
        "promptPolicy": "own-required",
        "required": {},
        "rolePolicies": [
          {
            "enabledWhen": [
              {
                "key": "inputMode",
                "operator": "equals",
                "value": "image"
              }
            ],
            "roles": {
              "audio": [],
              "image": [
                "reference-image"
              ],
              "text": [
                "instruction"
              ],
              "video": []
            }
          }
        ],
        "roles": {
          "audio": [],
          "image": [
            "reference-image"
          ],
          "text": [
            "instruction"
          ],
          "video": []
        },
        "switchPolicy": "keep-edge"
      },
      "referenceInputs": {
        "audio": 0,
        "image": 14,
        "video": 0
      },
      "referenceMediaRules": {
        "image": {
          "contentTypes": [
            "image/png"
          ],
          "maxBytes": 31457280
        }
      },
      "referencePolicy": {
        "modeKey": "inputMode",
        "modes": {
          "image": {
            "sets": [
              {
                "audio": 0,
                "image": 14,
                "video": 0
              }
            ]
          },
          "text": {
            "sets": [
              {
                "audio": 0,
                "image": 0,
                "video": 0
              }
            ]
          }
        }
      },
      "version": 2
    },
    "connectorFamily": "specialized-code",
    "connectorVersion": 1,
    "documentation": [],
    "evidence": "SPECIALIZED",
    "executionContract": {
      "connectorFamily": "specialized-code",
      "connectorVersion": 1,
      "create": {
        "method": "POST",
        "path": "/v1/media/generate"
      },
      "modes": [
        {
          "bindings": [
            {
              "source": {
                "kind": "model-id"
              },
              "target": {
                "location": "json",
                "path": "model"
              }
            },
            {
              "source": {
                "kind": "prompt"
              },
              "target": {
                "location": "json",
                "path": "prompt"
              }
            }
          ],
          "id": "specialized-code",
          "prompt": "required",
          "roles": []
        }
      ],
      "result": {
        "resultPath": "result_url"
      },
      "version": 1
    },
    "modelId": "cb2e1041-33f5-49ff-bc99-994a97622db4",
    "providerModelId": "gemini-3-pro-image-preview",
    "providerProfileId": "06831aee-5794-44cd-8e43-cc613eb60fdf",
    "providerProtocol": "media-generate",
    "runtime": "specialized-code"
  },
  "cbaf438c-1c36-48e2-807d-4ce78367d0cf": {
    "capability": "image",
    "capabilitySchema": {
      "fields": [
        {
          "defaultValue": "text",
          "group": "input",
          "key": "inputMode",
          "label": "生成方式",
          "options": [
            {
              "label": "文本",
              "value": "text"
            },
            {
              "label": "图片参考",
              "value": "image"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "9:16",
          "group": "main",
          "key": "aspectRatio",
          "label": "比例",
          "options": [
            {
              "label": "1:1",
              "value": "1:1"
            },
            {
              "label": "16:9",
              "value": "16:9"
            },
            {
              "label": "9:16",
              "value": "9:16"
            },
            {
              "label": "4:3",
              "value": "4:3"
            },
            {
              "label": "3:4",
              "value": "3:4"
            },
            {
              "label": "3:2",
              "value": "3:2"
            },
            {
              "label": "2:3",
              "value": "2:3"
            },
            {
              "label": "5:4",
              "value": "5:4"
            },
            {
              "label": "4:5",
              "value": "4:5"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "2k",
          "group": "main",
          "key": "quality",
          "label": "画质",
          "options": [
            {
              "label": "1K",
              "value": "1k"
            },
            {
              "label": "2K",
              "value": "2k"
            },
            {
              "label": "4K",
              "value": "4k"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 1,
          "group": "output",
          "key": "outputCount",
          "label": "数量",
          "options": [
            {
              "label": "1×",
              "value": 1
            }
          ],
          "summary": true,
          "type": "select"
        }
      ],
      "groups": [
        {
          "key": "input",
          "label": "输入",
          "order": 10
        },
        {
          "key": "main",
          "label": "参数",
          "order": 20
        },
        {
          "key": "advanced",
          "label": "高级设置",
          "order": 30
        },
        {
          "key": "output",
          "label": "输出",
          "order": 40
        }
      ],
      "inputPolicy": {
        "promptPolicy": "own-required",
        "required": {},
        "rolePolicies": [
          {
            "enabledWhen": [
              {
                "key": "inputMode",
                "operator": "equals",
                "value": "image"
              }
            ],
            "roles": {
              "audio": [],
              "image": [
                "reference-image"
              ],
              "text": [
                "instruction"
              ],
              "video": []
            }
          }
        ],
        "roles": {
          "audio": [],
          "image": [
            "reference-image"
          ],
          "text": [
            "instruction"
          ],
          "video": []
        },
        "switchPolicy": "keep-edge"
      },
      "referenceInputs": {
        "audio": 0,
        "image": 1,
        "video": 0
      },
      "referenceMediaRules": {
        "image": {
          "contentTypes": [
            "image/png"
          ],
          "maxBytes": 31457280
        }
      },
      "referencePolicy": {
        "modeKey": "inputMode",
        "modes": {
          "image": {
            "sets": [
              {
                "audio": 0,
                "image": 1,
                "video": 0
              }
            ]
          },
          "text": {
            "sets": [
              {
                "audio": 0,
                "image": 0,
                "video": 0
              }
            ]
          }
        }
      },
      "upstreamInputs": {
        "audio": {
          "limitMode": "fixed",
          "maxCount": 0,
          "supported": false
        },
        "image": {
          "limitMode": "context",
          "supported": true
        },
        "text": {
          "limitMode": "context",
          "supported": true
        },
        "video": {
          "limitMode": "fixed",
          "maxCount": 0,
          "supported": false
        }
      },
      "version": 2
    },
    "connectorFamily": "gpt-image",
    "connectorVersion": 1,
    "documentation": [
      {
        "checkedAt": "2026-08-27",
        "url": "https://platform.openai.com/docs/guides/image-generation"
      }
    ],
    "evidence": "EXACT",
    "executionContract": {
      "connectorFamily": "gpt-image",
      "connectorVersion": 1,
      "create": {
        "method": "POST",
        "path": "/v1/images/generations"
      },
      "modes": [
        {
          "bindings": [
            {
              "source": {
                "kind": "model-id"
              },
              "target": {
                "location": "json",
                "path": "model"
              }
            },
            {
              "source": {
                "kind": "prompt"
              },
              "target": {
                "location": "json",
                "path": "prompt"
              }
            }
          ],
          "id": "specialized-code",
          "prompt": "required",
          "roles": []
        }
      ],
      "result": {
        "resultPath": "data.0.b64_json"
      },
      "version": 1
    },
    "modelId": "cbaf438c-1c36-48e2-807d-4ce78367d0cf",
    "providerModelId": "gpt-image-2",
    "providerProfileId": "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    "providerProtocol": "gpt-image",
    "runtime": "specialized-code"
  },
  "ee51d65e-c924-4a9a-b224-6c4ee180a0ce": {
    "capability": "text",
    "capabilitySchema": {
      "fields": [
        {
          "defaultValue": "text",
          "group": "input",
          "key": "inputMode",
          "label": "生成方式",
          "options": [
            {
              "label": "文本",
              "value": "text"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "medium",
          "group": "main",
          "key": "thinkingLevel",
          "label": "推理档位",
          "options": [
            {
              "label": "关闭",
              "value": "minimal"
            },
            {
              "label": "开启",
              "value": "medium"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "text",
          "group": "output",
          "key": "responseFormat",
          "label": "输出格式",
          "options": [
            {
              "label": "文本",
              "value": "text"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 1,
          "group": "output",
          "key": "outputCount",
          "label": "数量",
          "options": [
            {
              "label": "1×",
              "value": 1
            }
          ],
          "summary": true,
          "type": "select"
        }
      ],
      "groups": [
        {
          "key": "input",
          "label": "输入",
          "order": 10
        },
        {
          "key": "main",
          "label": "参数",
          "order": 20
        },
        {
          "key": "advanced",
          "label": "高级设置",
          "order": 30
        },
        {
          "key": "output",
          "label": "输出",
          "order": 40
        }
      ],
      "referenceInputs": {
        "audio": 0,
        "image": 0,
        "video": 0
      },
      "upstreamInputs": {
        "audio": {
          "limitMode": "context",
          "note": "URL/Base64单文件不超过25MB且不超过120分钟；Files API单文件不超过512MB",
          "supported": true
        },
        "image": {
          "limitMode": "context",
          "note": "URL/Base64单图小于10MB；Files API单文件不超过512MB",
          "supported": true
        },
        "text": {
          "limitMode": "context",
          "note": "文字与其他素材共同计入229376输入Token上限",
          "supported": true
        },
        "video": {
          "limitMode": "context",
          "note": "URL/Base64单视频不超过50MB；Files API单文件不超过512MB，单视频最多使用80000 Token",
          "supported": true
        }
      },
      "version": 2
    },
    "connectorFamily": "ark-native",
    "connectorVersion": 1,
    "documentation": [],
    "evidence": "SPECIALIZED",
    "executionContract": {
      "connectorFamily": "ark-native",
      "connectorVersion": 1,
      "create": {
        "method": "POST",
        "path": "/api/v3/chat/completions"
      },
      "modes": [
        {
          "bindings": [
            {
              "source": {
                "kind": "model-id"
              },
              "target": {
                "location": "json",
                "path": "model"
              }
            },
            {
              "source": {
                "kind": "prompt"
              },
              "target": {
                "location": "json",
                "path": "prompt"
              }
            }
          ],
          "id": "specialized-code",
          "prompt": "required",
          "roles": []
        }
      ],
      "result": {
        "resultPath": "output.0.content.0.text"
      },
      "version": 1
    },
    "modelId": "ee51d65e-c924-4a9a-b224-6c4ee180a0ce",
    "providerModelId": "doubao-seed-2-0-lite-260428",
    "providerProfileId": "f8ed7ddc-7c09-413d-8c8f-b594c39bfe7c",
    "providerProtocol": "native",
    "runtime": "specialized-code"
  },
  "f2abd864-4e38-4081-af52-820629032033": {
    "capability": "video",
    "capabilitySchema": {
      "fields": [
        {
          "defaultValue": "reference",
          "group": "input",
          "key": "inputMode",
          "label": "生成方式",
          "options": [
            {
              "label": "参考",
              "value": "reference"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "16:9",
          "group": "main",
          "key": "aspectRatio",
          "label": "比例",
          "options": [
            {
              "label": "1:1",
              "value": "1:1"
            },
            {
              "label": "16:9",
              "value": "16:9"
            },
            {
              "label": "9:16",
              "value": "9:16"
            },
            {
              "label": "3:2",
              "value": "3:2"
            },
            {
              "label": "2:3",
              "value": "2:3"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": "480p",
          "group": "main",
          "key": "resolution",
          "label": "清晰度",
          "options": [
            {
              "label": "480p",
              "value": "480p"
            },
            {
              "label": "720p",
              "value": "720p"
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": 5,
          "group": "main",
          "key": "duration",
          "label": "时长",
          "options": [
            {
              "label": "1s",
              "value": 1
            },
            {
              "label": "2s",
              "value": 2
            },
            {
              "label": "3s",
              "value": 3
            },
            {
              "label": "4s",
              "value": 4
            },
            {
              "label": "5s",
              "value": 5
            },
            {
              "label": "6s",
              "value": 6
            },
            {
              "label": "7s",
              "value": 7
            },
            {
              "label": "8s",
              "value": 8
            },
            {
              "label": "9s",
              "value": 9
            },
            {
              "label": "10s",
              "value": 10
            },
            {
              "label": "11s",
              "value": 11
            },
            {
              "label": "12s",
              "value": 12
            },
            {
              "label": "13s",
              "value": 13
            },
            {
              "label": "14s",
              "value": 14
            },
            {
              "label": "15s",
              "value": 15
            }
          ],
          "summary": true,
          "type": "select"
        },
        {
          "defaultValue": true,
          "group": "main",
          "key": "generateAudio",
          "label": "生成音频",
          "options": [
            {
              "label": "开启",
              "value": true
            },
            {
              "label": "关闭",
              "value": false
            }
          ],
          "summary": true,
          "type": "boolean"
        },
        {
          "defaultValue": 1,
          "group": "output",
          "key": "outputCount",
          "label": "数量",
          "options": [
            {
              "label": "1×",
              "value": 1
            }
          ],
          "summary": true,
          "type": "select"
        }
      ],
      "groups": [
        {
          "key": "input",
          "label": "输入",
          "order": 10
        },
        {
          "key": "main",
          "label": "参数",
          "order": 20
        },
        {
          "key": "advanced",
          "label": "高级设置",
          "order": 30
        },
        {
          "key": "output",
          "label": "输出",
          "order": 40
        }
      ],
      "inputPolicy": {
        "promptPolicy": "own-required",
        "required": {},
        "rolePolicies": [
          {
            "assignment": {
              "image": [
                "first-frame"
              ]
            },
            "enabledWhen": [
              {
                "key": "inputMode",
                "operator": "equals",
                "value": "reference"
              }
            ],
            "limits": [
              {
                "kind": "image",
                "maxCount": 1,
                "minCount": 1,
                "role": "first-frame"
              }
            ],
            "roles": {
              "audio": [],
              "image": [
                "first-frame"
              ],
              "text": [
                "instruction"
              ],
              "video": []
            }
          }
        ],
        "roles": {
          "audio": [],
          "image": [
            "first-frame"
          ],
          "text": [
            "instruction"
          ],
          "video": []
        },
        "switchPolicy": "keep-edge"
      },
      "referenceInputs": {
        "audio": 0,
        "image": 1,
        "video": 0
      },
      "referencePolicy": {
        "modeKey": "inputMode",
        "modes": {
          "reference": {
            "sets": [
              {
                "audio": 0,
                "image": 1,
                "video": 0
              }
            ]
          }
        }
      },
      "version": 2
    },
    "connectorFamily": "specialized-code",
    "connectorVersion": 1,
    "documentation": [
      {
        "checkedAt": "2026-08-27",
        "url": "https://docs.x.ai/developers/models/grok-imagine-video"
      }
    ],
    "evidence": "SPECIALIZED",
    "executionContract": {
      "connectorFamily": "specialized-code",
      "connectorVersion": 1,
      "create": {
        "method": "POST",
        "path": "/v1/media/generate"
      },
      "modes": [
        {
          "bindings": [
            {
              "source": {
                "kind": "model-id"
              },
              "target": {
                "location": "json",
                "path": "model"
              }
            },
            {
              "source": {
                "kind": "prompt"
              },
              "target": {
                "location": "json",
                "path": "prompt"
              }
            }
          ],
          "id": "specialized-code",
          "prompt": "required",
          "roles": []
        }
      ],
      "result": {
        "resultPath": "result_url"
      },
      "version": 1
    },
    "modelId": "f2abd864-4e38-4081-af52-820629032033",
    "providerModelId": "grok-imagine-video-1.5-preview",
    "providerProfileId": "37f7921b-18f0-43d3-91c5-dfed74f693b3",
    "providerProtocol": "media-generate",
    "runtime": "specialized-code"
  }
} as const satisfies Readonly<Record<string, ModelReleaseDocument>>;
