#include <iostream>
// @phase recurse
void hanoi(int n, int from, int spare, int to, int positions[], int moveState[]) {
    if (n == 0) { return; }
    hanoi(n - 1, from, to, spare, positions, moveState);
    // @phase prepare
    moveState[1] = from;
    moveState[2] = to;
    moveState[3] = n - 1;
    // @phase move
    positions[n - 1] = to;
    moveState[0] = moveState[0] + 1;
    std::cout << "MOVE " << n << " " << from << " " << to << "\n";
    // @phase resume
    hanoi(n - 1, spare, from, to, positions, moveState);
}
// @phase input
int main() {
    int n;
    std::cin >> n;
    // @phase domain
    if (n < 0 || n > 5) {
        std::cout << "DOMAIN\n";
        return 1;
    }
    // @phase setup
    int positions[5] = {};
    int moveState[4] = {};
    hanoi(n, 0, 1, 2, positions, moveState);
    // @phase finish
    std::cout << "MOVES " << moveState[0] << "\n";
    return 0;
}
