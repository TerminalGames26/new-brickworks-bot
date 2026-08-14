const GROUP_ID = process.env.GROUP_ID;
const API_KEY = process.env.ROBLOX_API_KEY;

const ROLE_3L = process.env.ROLE_3L;
const ROLE_4L = process.env.ROLE_4L;
const ROLE_5L = process.env.ROLE_5L;
const ROLE_VERIFIED = process.env.ROLE_VERIFIED;

if (!GROUP_ID || !API_KEY) {
    throw new Error("Missing GROUP_ID or ROBLOX_API_KEY");
}

async function roblox(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            "x-api-key": API_KEY,
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const text = await response.text();

    let data;
    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        data = { raw: text };
    }

    if (!response.ok) {
        throw new Error(
            `Roblox API ${response.status}: ${JSON.stringify(data)}`
        );
    }

    return data;
}

async function getJoinRequests() {
    return roblox(
        `https://apis.roblox.com/cloud/v2/groups/${GROUP_ID}/join-requests`
    );
}

async function getUser(userId) {
    const response = await fetch(
        `https://users.roblox.com/v1/users/${userId}`
    );

    if (!response.ok) {
        throw new Error(`Unable to get user ${userId}: ${response.status}`);
    }

    return response.json();
}

async function getRobloxBadges(userId) {
    const response = await fetch(
        `https://accountinformation.roblox.com/v1/users/${userId}/roblox-badges`
    );

    if (!response.ok) {
        throw new Error(
            `Unable to get Roblox badges for ${userId}: ${response.status}`
        );
    }

    return response.json();
}

function getRoleForUsername(username) {
    const length = [...username].length;

    if (length === 3) return ROLE_3L;
    if (length === 4) return ROLE_4L;
    if (length === 5) return ROLE_5L;

    return null;
}

async function acceptRequest(requestId) {
    return roblox(
        `https://apis.roblox.com/cloud/v2/groups/${GROUP_ID}/join-requests/${requestId}:accept`,
        {
            method: "POST"
        }
    );
}

async function getMemberships() {
    return roblox(
        `https://apis.roblox.com/cloud/v2/groups/${GROUP_ID}/memberships`
    );
}

async function findMembership(userId) {
    let pageToken = "";

    while (true) {
        const url = new URL(
            `https://apis.roblox.com/cloud/v2/groups/${GROUP_ID}/memberships`
        );

        url.searchParams.set("pageSize", "100");

        if (pageToken) {
            url.searchParams.set("pageToken", pageToken);
        }

        const data = await roblox(url.toString());

        const memberships = data.groupMemberships || [];

        const found = memberships.find(
            membership =>
                String(membership.user?.userId) === String(userId)
        );

        if (found) {
            return found;
        }

        pageToken = data.nextPageToken || "";

        if (!pageToken) {
            return null;
        }
    }
}

async function assignRole(membershipId, roleId) {
    return roblox(
        `https://apis.roblox.com/cloud/v2/groups/${GROUP_ID}/memberships/${membershipId}:assignRole`,
        {
            method: "POST",
            body: JSON.stringify({
                roleId: String(roleId)
            })
        }
    );
}

async function processRequest(request) {
    const userId =
        request.user?.userId ??
        request.userId;

    if (!userId) {
        console.log("Skipping request with no user ID.");
        return;
    }

    const user = await getUser(userId);
    const username = user.name;

    console.log(`Checking ${username} (${userId})`);

    const roleId = getRoleForUsername(username);

    // Anything other than 3, 4, or 5 characters stays pending.
    if (!roleId) {
        console.log(
            `${username}: username length is not 3-5. Leaving pending.`
        );
        return;
    }

    /*
     * Check the user's Roblox badges.
     *
     * We only use this to determine whether the Verified role
     * should ALSO be assigned.
     */
    let verified = false;

    try {
        const badges = await getRobloxBadges(userId);

        verified = Array.isArray(badges)
            ? badges.some(badge =>
                String(badge.name || "")
                    .toLowerCase()
                    .includes("verified")
            )
            : false;
    } catch (error) {
        console.log(
            `Could not check Roblox verification for ${username}:`,
            error.message
        );

        // Do not grant the Verified role if verification cannot be confirmed.
        verified = false;
    }

    console.log(
        `${username}: ${[...username].length} characters, verified=${verified}`
    );

    /*
     * ACCEPT ONLY AFTER ALL REQUIREMENTS FOR THE USERNAME
     * HAVE BEEN CONFIRMED.
     */
    await acceptRequest(request.id);

    console.log(`Accepted ${username}.`);

    /*
     * Find the newly-created membership.
     *
     * We do NOT scan existing members and change their roles.
     * This is only for the person whose request we just accepted.
     */
    let membership = null;

    for (let attempt = 0; attempt < 10; attempt++) {
        membership = await findMembership(userId);

        if (membership) break;

        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    if (!membership) {
        console.log(
            `Accepted ${username}, but membership was not found yet.`
        );
        return;
    }

    /*
     * Assign the username-length role.
     *
     * We intentionally do not remove or replace any other roles.
     */
    await assignRole(membership.name, roleId);

    console.log(`Assigned username role to ${username}.`);

    /*
     * Verified is an additional role.
     */
    if (verified) {
        await assignRole(membership.name, ROLE_VERIFIED);
        console.log(`Assigned Verified role to ${username}.`);
    }
}

async function main() {
    console.log("Epic Brickworks bot starting...");
    console.log(new Date().toISOString());

    const data = await getJoinRequests();
    const requests = data.groupJoinRequests || [];

    console.log(`Pending requests: ${requests.length}`);

    for (const request of requests) {
        try {
            await processRequest(request);
        } catch (error) {
            console.error(
                `Error processing request ${request.id}:`,
                error.message
            );
        }
    }

    console.log("Finished.");
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
