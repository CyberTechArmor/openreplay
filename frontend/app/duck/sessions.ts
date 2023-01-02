import { List, Map } from 'immutable';
import Session from 'Types/session';
import ErrorStack from 'Types/session/errorStack';
import { Location, InjectedEvent } from 'Types/session/event'
import Watchdog from 'Types/watchdog';
import { clean as cleanParams } from 'App/api_client';
import withRequestState, { RequestTypes } from './requestStateCreator';
import { getRE, setSessionFilter, getSessionFilter, compareJsonObjects, cleanSessionFilters } from 'App/utils';
import { LAST_7_DAYS } from 'Types/app/period';
import { getDateRangeFromValue } from 'App/dateRange';

const name = 'sessions';
const FETCH_LIST = new RequestTypes('sessions/FETCH_LIST');
const FETCH_AUTOPLAY_LIST = new RequestTypes('sessions/FETCH_AUTOPLAY_LIST');
const FETCH = new RequestTypes('sessions/FETCH');
const FETCH_FAVORITE_LIST = new RequestTypes('sessions/FETCH_FAVORITE_LIST');
const FETCH_LIVE_LIST = new RequestTypes('sessions/FETCH_LIVE_LIST');
const TOGGLE_FAVORITE = new RequestTypes('sessions/TOGGLE_FAVORITE');
const FETCH_ERROR_STACK = new RequestTypes('sessions/FETCH_ERROR_STACK');
const FETCH_INSIGHTS = new RequestTypes('sessions/FETCH_INSIGHTS');
const SORT = 'sessions/SORT';
const REDEFINE_TARGET = 'sessions/REDEFINE_TARGET';
const SET_TIMEZONE = 'sessions/SET_TIMEZONE';
const SET_EVENT_QUERY = 'sessions/SET_EVENT_QUERY';
const SET_AUTOPLAY_VALUES = 'sessions/SET_AUTOPLAY_VALUES';
const TOGGLE_CHAT_WINDOW = 'sessions/TOGGLE_CHAT_WINDOW';
const SET_FUNNEL_PAGE_FLAG = 'sessions/SET_FUNNEL_PAGE_FLAG';
const SET_TIMELINE_POINTER = 'sessions/SET_TIMELINE_POINTER';
const SET_TIMELINE_HOVER_POINTER = 'sessions/SET_TIMELINE_HOVER_POINTER';

const SET_CREATE_NOTE_TOOLTIP = 'sessions/SET_CREATE_NOTE_TOOLTIP'
const SET_EDIT_NOTE_TOOLTIP = 'sessions/SET_EDIT_NOTE_TOOLTIP'
const FILTER_OUT_NOTE = 'sessions/FILTER_OUT_NOTE'
const ADD_NOTE = 'sessions/ADD_NOTE'
const UPDATE_NOTE = 'sessions/UPDATE_NOTE'

const SET_SESSION_PATH = 'sessions/SET_SESSION_PATH';
const LAST_PLAYED_SESSION_ID = `${name}/LAST_PLAYED_SESSION_ID`;
const SET_ACTIVE_TAB = 'sessions/SET_ACTIVE_TAB';

const range = getDateRangeFromValue(LAST_7_DAYS);
const defaultDateFilters = {
    url: '',
    rangeValue: LAST_7_DAYS,
    startDate: range.start.unix() * 1000,
    endDate: range.end.unix() * 1000,
};

const initObj = {
    list: [],
    sessionIds: [],
    current: new Session(),
    total: 0,
    keyMap: Map(),
    wdTypeCount: Map(),
    favoriteList: List(),
    activeTab: Watchdog({ name: 'All', type: 'all' }),
    timezone: 'local',
    errorStack: List(),
    eventsIndex: [],
    sourcemapUploaded: true,
    filteredEvents: null,
    eventsQuery: '',
    showChatWindow: false,
    liveSessions: [],
    visitedEvents: List(),
    insights: List(),
    insightFilters: defaultDateFilters,
    host: '',
    funnelPage: Map(),
    timelinePointer: null,
    sessionPath: {},
    lastPlayedSessionId: null,
    timeLineTooltip: { time: 0, offset: 0, isVisible: false, timeStr: '' },
    createNoteTooltip: { time: 0, isVisible: false, isEdit: false, note: null },
}

const initialState = Map(initObj);

interface IAction extends Record<string, any>{
    type: string;
    data: any;
}

const reducer = (state = initialState, action: IAction) => {
    switch (action.type) {
        case FETCH_ERROR_STACK.SUCCESS:
            return state.set('errorStack', List(action.data.trace).map(es => new ErrorStack(es))).set('sourcemapUploaded', action.data.sourcemapUploaded);
        case FETCH_LIVE_LIST.SUCCESS:
            const liveList = action.data.sessions.map((s) => new Session({ ...s, live: true }));
            return state.set('liveSessions', liveList);
        case FETCH_LIST.SUCCESS:
            const { sessions, total } = action.data;
            const list = sessions.map(s => new Session(s));

            console.log(sessions, list, action)
            return state
                .set('list', list)
                .set('sessionIds', list.map(({ sessionId }) => sessionId))
                .set('favoriteList', list.filter(({ favorite }) => favorite))
                .set('total', total);
        case FETCH_AUTOPLAY_LIST.SUCCESS:
            let sessionIds = state.get('sessionIds');
            sessionIds = sessionIds.concat(action.data.map(i => i.sessionId + ''))
            return state.set('sessionIds', sessionIds.filter((i, index) => sessionIds.indexOf(i) === index ))
        case SET_AUTOPLAY_VALUES: {
            const sessionIds = state.get('sessionIds');
            const currentSessionId = state.get('current').sessionId;
            const currentIndex = sessionIds.indexOf(currentSessionId);
            return state.set('previousId', sessionIds[currentIndex - 1]).set('nextId', sessionIds[currentIndex + 1]);
        }
        case SET_EVENT_QUERY: {
            const events = state.get('current').events;
            const query = action.filter.query;
            const searchRe = getRE(query, 'i');

            const filteredEvents = query ? events.filter(
                (e) => searchRe.test(e.url)
                    || searchRe.test(e.value)
                    || searchRe.test(e.label)
                    || searchRe.test(e.type)
                    || (e.type === 'LOCATION' && searchRe.test('visited'))
            ) : null;

            return state.set('filteredEvents', filteredEvents).set('eventsQuery', query);
        }
        case FETCH.SUCCESS: {
            // TODO: more common.. or TEMP
            const events = action.filter.events;
            const session = new Session(action.data);

            const matching: number[] = [];

            const visitedEvents: Location[] = [];
            const tmpMap = new Set();
            session.events.forEach((event) => {
                if (event.type === 'LOCATION' && !tmpMap.has(event.url)) {
                    tmpMap.add(event.url);
                    visitedEvents.push(event);
                }
            });

            events.forEach(({ key, operator, value }) => {
                session.events.forEach((e, index) => {
                    if (key === e.type) {
                        const val = e.type === 'LOCATION' ? e.url : e.value;
                        if (operator === 'is' && value === val) {
                            matching.push(index);
                        }
                        if (operator === 'contains' && val.includes(value)) {
                            matching.push(index);
                        }
                    }
                });
            });
            return state
                .set('current', session)
                .set('eventsIndex', matching)
                .set('visitedEvents', visitedEvents)
                .set('host', visitedEvents[0] && visitedEvents[0].host);
        }
        case FETCH_FAVORITE_LIST.SUCCESS:
            return state.set('favoriteList', action.data.map(s => new Session(s)));
        case TOGGLE_FAVORITE.SUCCESS: {
            const id = action.sessionId;
            let mutableState = state
            const list = state.get('list') as unknown as Session[]
            const sessionIdx = list.findIndex(({ sessionId }) => sessionId === id);
            const session = list[sessionIdx]
            const current = state.get('current') as unknown as Session;
            const wasInFavorite = state.get('favoriteList').findIndex(({ sessionId }) => sessionId === id) > -1;

            if (session && !wasInFavorite) {
                session.favorite = true
                mutableState = mutableState.updateIn(['list', sessionIdx], () => session)
            }
            if (current.sessionId === id) {
                mutableState = mutableState.update('current',
                  (s: Session) => ({ ...s, favorite: !wasInFavorite})
                )
            }
            return mutableState
                .update('favoriteList', (list: Session[]) => session ?
                    wasInFavorite ? list.filter(({ sessionId }) => sessionId !== id) : list.push(session) : list
                );
        }
        case SORT: {
            const comparator = (s1, s2) => {
                let diff = s1[action.sortKey] - s2[action.sortKey];
                diff = diff === 0 ? s1.startedAt - s2.startedAt : diff;
                return action.sign * diff;
            };
            return state.update('list', (list: Session[]) => list.sort(comparator)).update('favoriteList', (list: Session[]) => list.sort(comparator));
        }
        case REDEFINE_TARGET: {
            // TODO: update for list
            const { label, path } = action.target;
            return state.updateIn(['current', 'events'], (list) =>
                list.map((event) => (event.target && event.target.path === path ? event.setIn(['target', 'label'], label) : event))
            );
        }
        case SET_ACTIVE_TAB:
            const allList = action.tab.type === 'all' ? state.get('list') : state.get('list').filter((s) => s.issueTypes.includes(action.tab.type));

            return state.set('activeTab', action.tab).set('sessionIds', allList.map(({ sessionId }) => sessionId).toJS());
        case SET_TIMEZONE:
            return state.set('timezone', action.timezone);
        case TOGGLE_CHAT_WINDOW:
            return state.set('showChatWindow', action.state);
        case FETCH_INSIGHTS.SUCCESS:
            return state.set(
                'insights',
                List(action.data).sort((a, b) => b.count - a.count)
            );
        case SET_FUNNEL_PAGE_FLAG:
            return state.set('funnelPage', action.funnelPage ? Map(action.funnelPage) : false);
        case SET_TIMELINE_POINTER:
            return state.set('timelinePointer', action.pointer);
        case SET_TIMELINE_HOVER_POINTER:
            return state.set('timeLineTooltip', action.timeLineTooltip);
        case SET_CREATE_NOTE_TOOLTIP:
            return state.set('createNoteTooltip', action.noteTooltip);
        case SET_EDIT_NOTE_TOOLTIP:
            return state.set('createNoteTooltip', action.noteTooltip);
        case FILTER_OUT_NOTE:
            return state.updateIn(['current'],
              (session: Session) => ({
                ...session,
                notesWithEvents: session.notesWithEvents.filter(item => {
                    if ('noteId' in item) {
                        return item.noteId !== action.noteId
                    }
                    return true
                })
              })
            )
        case ADD_NOTE:
            return state.updateIn(['current', 'notesWithEvents'], (list) =>
                list.push(action.note).sort((a, b) => {
                    const aTs = a.time || a.timestamp
                    const bTs = b.time || b.timestamp

                    return aTs - bTs
                  })
            )
        case UPDATE_NOTE:
            const noteIndex = state.getIn(['current']).notesWithEvents.findIndex(item => item.noteId === action.note.noteId)
            return state.setIn(['current', 'notesWithEvents', noteIndex], action.note)
        case SET_SESSION_PATH:
            return state.set('sessionPath', action.path);
        case LAST_PLAYED_SESSION_ID:
            const sessionList = state.get('list') as unknown as Session[];
            const sIndex = sessionList.findIndex(({ sessionId }) => sessionId === action.sessionId);
            if (sIndex === -1) return state;

            return state.updateIn(['list', sIndex], (session: Session) => ({ ...session, viewed: true }));
        default:
            return state;
    }
};

export default withRequestState(
    {
        _: [FETCH, FETCH_LIST],
        fetchLiveListRequest: FETCH_LIVE_LIST,
        fetchFavoriteListRequest: FETCH_FAVORITE_LIST,
        toggleFavoriteRequest: TOGGLE_FAVORITE,
        fetchErrorStackList: FETCH_ERROR_STACK,
        fetchInsightsRequest: FETCH_INSIGHTS,
    },
    reducer
);

export const fetchList =
    (params = {}, force = false) =>
    (dispatch) => {
        if (!force) { // compare with the last fetched filter
            const oldFilters = getSessionFilter();
            if (compareJsonObjects(oldFilters, cleanSessionFilters(params))) {
                return;
            }
        }

        setSessionFilter(cleanSessionFilters(params));
        return dispatch({
            types: FETCH_LIST.toArray(),
            call: (client) => client.post('/sessions/search', params),
            params: cleanParams(params),
        });
    };

export const fetchAutoplayList =
    (params = {}) =>
    (dispatch) => {
        setSessionFilter(cleanSessionFilters(params));
        return dispatch({
            types: FETCH_AUTOPLAY_LIST.toArray(),
            call: (client) => client.post('/sessions/search/ids', params),
            params: cleanParams(params),
        });
    };



export function fetchErrorStackList(sessionId, errorId) {
    return {
        types: FETCH_ERROR_STACK.toArray(),
        call: (client) => client.get(`/sessions/${sessionId}/errors/${errorId}/sourcemaps`),
    };
}

export const fetch =
    (sessionId, isLive = false) =>
    (dispatch, getState) => {
        dispatch({
            types: FETCH.toArray(),
            call: (client) => client.get(isLive ? `/assist/sessions/${sessionId}` : `/sessions/${sessionId}`),
            filter: getState().getIn(['filters', 'appliedFilter']),
        });
    };

export function toggleFavorite(sessionId) {
    return {
        types: TOGGLE_FAVORITE.toArray(),
        call: (client) => client.get(`/sessions/${sessionId}/favorite`),
        sessionId,
    };
}

export function fetchInsights(params) {
    return {
        types: FETCH_INSIGHTS.toArray(),
        call: (client) => client.post('/heatmaps/url', params),
    };
}

export function fetchLiveList(params = {}) {
    return {
        types: FETCH_LIVE_LIST.toArray(),
        call: (client) => client.get('/assist/sessions', params),
    };
}

export function toggleChatWindow(state) {
    return {
        type: TOGGLE_CHAT_WINDOW,
        state,
    };
}

export function sort(sortKey, sign = 1, listName = 'list') {
    return {
        type: SORT,
        sortKey,
        sign,
        listName,
    };
}

export const setAutoplayValues = (sessionId) => {
    return {
        type: SET_AUTOPLAY_VALUES,
        sessionId,
    };
};

export const setActiveTab = (tab) => ({
    type: SET_ACTIVE_TAB,
    tab,
});

export function setTimezone(timezone) {
    return {
        type: SET_TIMEZONE,
        timezone,
    };
}

export function setEventFilter(filter) {
    return {
        type: SET_EVENT_QUERY,
        filter,
    };
}

export function setFunnelPage(funnelPage) {
    return {
        type: SET_FUNNEL_PAGE_FLAG,
        funnelPage,
    };
}

export function setTimelinePointer(pointer) {
    return {
        type: SET_TIMELINE_POINTER,
        pointer,
    };
}

export function setTimelineHoverTime(timeLineTooltip) {
    return {
        type: SET_TIMELINE_HOVER_POINTER,
        timeLineTooltip
    };
}

export function setCreateNoteTooltip(noteTooltip) {
    return {
        type: SET_CREATE_NOTE_TOOLTIP,
        noteTooltip
    }
}

export function setEditNoteTooltip(noteTooltip) {
    return {
        type: SET_EDIT_NOTE_TOOLTIP,
        noteTooltip
    }
}

export function filterOutNote(noteId) {
    return {
        type: FILTER_OUT_NOTE,
        noteId
    }
}

export function addNote(note) {
    return {
        type: ADD_NOTE,
        note
    }
}

export function updateNote(note) {
    return {
        type: UPDATE_NOTE,
        note
    }
}

export function setSessionPath(path) {
    return {
        type: SET_SESSION_PATH,
        path,
    };
}

export function updateLastPlayedSession(sessionId) {
    return {
        type: LAST_PLAYED_SESSION_ID,
        sessionId,
    };
}
